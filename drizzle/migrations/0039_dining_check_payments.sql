-- 0039_dining_check_payments — dining room, step 3: pay and close each check.
--
-- Payment model (the master document forbids lifting the one-payment-per-order rule without an
-- allocation and reconciliation design; this is that design, and the rule stays):
--   * dining_check_payments  the TENDERS of a check: method, amount applied to the check, tip, cash
--                            handed over and change. Several per check: split by person, by amount or
--                            by items is several partial payments on one check (the screen computes
--                            the amounts); separate bills are separate checks (0038). A tender is
--                            recorded, never edited; a mistake on an open check is reversed
--                            (void_check_payment, orders.refund).
--   * when a check's balance reaches zero it CLOSES, in the same transaction as the payment that
--     settled it, exactly once:
--       - each live round (order) gets ONE row in payments (the existing table, order_id UNIQUE): the
--         allocation of the check's tenders to that order, amount = the order total, method = the
--         tenders' method, or 'mixed' when the check was paid with more than one method (the only
--         change to payments: 'mixed' joins the allowed methods). Orders and reports then count the
--         round as a paid sale exactly like a POS sale (isRecordedSale reads payments);
--       - revenue (total minus tax) and COGS (the cost recorded on the movements when the round was
--         sent to the kitchen) go to finance_entries with the POS keys ('sale:<order id>'), so the
--         ledger's unique key makes a second posting impossible;
--       - tips are NOT revenue: they stay on the tenders (owed to the staff), reported separately later.
--   * when the last check of the table is closed (empty checks are voided) the session closes and the
--     table goes to cleaning.
--   * a round of a check that has a recorded tender, or of a closed check, can no longer be voided:
--     cancel_order_with_reversal refuses with check_has_payments (refunds of paid checks come with the
--     real payment processor). cancel_order_with_reversal now locks the check BEFORE the order, the
--     same order as paying (check, then orders), so the two never deadlock.
--   * a whole round can be moved to another open check of the same table (move_check_round) while
--     neither check has a tender.
--
-- Who: paying needs tables.serve AND pos.sell (recording a payment is selling, as in the POS);
-- reversing a tender needs orders.refund. Same feature (table_service), same store scope.
-- Concurrency (READ COMMITTED): every write locks the check (FOR UPDATE), the same lock rounds and
-- closing take, so a payment, a round, a void, a move and a close are serialized per check; two
-- payments for the same balance: the second sees the reduced balance (payment_exceeds_balance).
-- Idempotency: each tender carries a client key (unique per organization); a replay returns it.
--
-- Rollback (a NEW migration): restore cancel_order_with_reversal from 0018, drop the RPCs below and
-- dining_check_payments, restore the payments method check without 'mixed' (only if no row uses it).
-- See docs/operations/dining-room-payments.md.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- payments: allocation method
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','card','digital','mixed'));

-- ---------------------------------------------------------------- tenders
create table public.dining_check_payments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  location_id     uuid not null,
  check_id        uuid not null,
  method          text not null check (method in ('cash','card','digital')),
  amount_cents    integer not null check (amount_cents > 0),
  tip_cents       integer not null default 0 check (tip_cents >= 0),
  tendered_cents  integer check (tendered_cents is null or tendered_cents >= 0),
  change_cents    integer not null default 0 check (change_cents >= 0),
  status          text not null default 'recorded' check (status in ('recorded','reversed')),
  client_key      text not null check (length(client_key) between 1 and 160),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  reversed_by     uuid,
  reversed_at     timestamptz,
  reversal_reason text check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 300),
  unique (org_id, client_key),
  check ((status = 'reversed') = (reversed_at is not null)),
  -- cash: what was handed over covers the amount and the tip; the rest is change
  check (method <> 'cash' or tendered_cents is null
         or tendered_cents = amount_cents + tip_cents + change_cents),
  check (method = 'cash' or (tendered_cents is null and change_cents = 0)),
  foreign key (org_id, location_id, check_id) references public.dining_checks (org_id, location_id, id)
);
create index dining_check_payments_check on public.dining_check_payments (check_id);

alter table public.dining_check_payments enable row level security;
create policy dining_check_payments_read on public.dining_check_payments for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));
revoke all on public.dining_check_payments from public, anon, authenticated;
grant select on public.dining_check_payments to authenticated;
grant all on public.dining_check_payments to service_role;

-- ---------------------------------------------------------------- helpers (internal)
-- Live total of a check (rounds not cancelled, tax included) and what its recorded tenders cover.
create or replace function public.dining_check_balance(_check_id uuid, out total_cents integer, out paid_cents integer)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(o.total_cents)::int from public.dining_check_rounds r
               join public.orders o on o.id = r.order_id
              where r.check_id = _check_id and o.status <> 'cancelled'), 0),
    coalesce((select sum(p.amount_cents)::int from public.dining_check_payments p
              where p.check_id = _check_id and p.status = 'recorded'), 0)
$$;
revoke all on function public.dining_check_balance(uuid) from public, anon, authenticated;

-- Close a check whose balance is zero: allocation rows, ledger, check closed; then the session and the
-- table when no other check is left to pay. The caller holds the check lock.
-- (Takes the id, not the row: a function of a table's row type would show as a computed column.)
create or replace function public.dining_close_paid_check_internal(_check_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _check public.dining_checks;
  o public.orders;
  method text;
  cost integer;
  s public.dining_sessions;
  t public.dining_tables;
begin
  select * into _check from public.dining_checks where id = _check_id;
  select case when count(distinct p.method) = 1 then min(p.method) else 'mixed' end into method
    from public.dining_check_payments p where p.check_id = _check.id and p.status = 'recorded';
  for o in select ord.* from public.dining_check_rounds r join public.orders ord on ord.id = r.order_id
            where r.check_id = _check.id and ord.status <> 'cancelled'
            order by ord.id for update of ord loop
    insert into public.payments (org_id, location_id, order_id, method, amount_cents)
    values (o.org_id, o.location_id, o.id, coalesce(method, 'cash'), o.total_cents);
    select coalesce(sum(round(-m.delta * m.unit_cost_cents)), 0)::int into cost
      from public.inventory_movements m where m.order_id = o.id and m.kind = 'sale';
    insert into public.finance_entries (org_id, location_id, order_id, kind, amount_cents, client_event_id, description, actor_id)
    values (o.org_id, o.location_id, o.id, 'revenue', o.total_cents - o.tax_cents, 'sale:' || o.id::text,
            'Dine-in check net of tax', auth.uid()),
           (o.org_id, o.location_id, o.id, 'cogs', cost, 'sale:' || o.id::text,
            'Recipe cost (configured ingredients only)', auth.uid());
  end loop;
  update public.dining_checks set status = 'closed', closed_at = now() where id = _check.id;
  perform public.write_audit(_check.org_id, 'tables.check_closed', _check.id::text,
    jsonb_build_object('method', method));
  -- the table: every other check is closed, void, or empty with no tender (then voided)
  select * into s from public.dining_sessions where id = _check.session_id for update;
  if s.status = 'open' and not exists (
       select 1 from public.dining_checks c
        where c.session_id = s.id and c.status = 'open'
          and (exists (select 1 from public.dining_check_rounds r join public.orders ord on ord.id = r.order_id
                        where r.check_id = c.id and ord.status <> 'cancelled')
               or exists (select 1 from public.dining_check_payments p
                           where p.check_id = c.id and p.status = 'recorded'))) then
    update public.dining_checks set status = 'void', closed_at = now() where session_id = s.id and status = 'open';
    update public.dining_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = s.id;
    select * into t from public.dining_tables where id = s.table_id for update;
    perform public.dining_table_set_status_internal(t, 'cleaning');
    perform public.write_audit(_check.org_id, 'tables.session_closed', s.id::text, jsonb_build_object('table', t.label));
  end if;
end $$;
revoke all on function public.dining_close_paid_check_internal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- pay
-- Records one tender on a check; returns {payment, check_status, balance_cents}. _amount_cents is what
-- this tender settles of the check (1..balance); _tip_cents on top; cash may say what was handed over
-- (_tendered_cents >= amount + tip; the rest is change). When the balance reaches zero the check closes.
-- Replaying the same _client_key returns the recorded tender (a different payload: idempotency_conflict).
create or replace function public.pay_dining_check(
  _org_id uuid,
  _location_id uuid,
  _check_id uuid,
  _client_key text,
  _method text,
  _amount_cents integer,
  _tip_cents integer default 0,
  _tendered_cents integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k text := btrim(coalesce(_client_key, ''));
  c public.dining_checks;
  s public.dining_sessions;
  p public.dining_check_payments;
  b record;
  pid uuid;
  chg integer := 0;
begin
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  perform public.assert_permission(_org_id, 'pos.sell', _location_id);
  if length(k) not between 1 and 160 then raise exception 'invalid_key'; end if;
  if _method is null or _method not in ('cash','card','digital') then raise exception 'invalid_payment'; end if;
  if _amount_cents is null or _amount_cents <= 0 then raise exception 'invalid_amount'; end if;
  if _tip_cents is null or _tip_cents < 0 or _tip_cents > 10000000 then raise exception 'invalid_tip'; end if;
  if _tendered_cents is not null and (_method <> 'cash' or _tendered_cents < _amount_cents + _tip_cents) then
    raise exception 'invalid_tendered';
  end if;
  select * into c from public.dining_checks
   where id = _check_id and org_id = _org_id and location_id = _location_id
   for update;
  if c.id is null then raise exception 'check_not_found'; end if;
  select * into p from public.dining_check_payments where org_id = _org_id and client_key = k;
  if p.id is not null then
    if p.check_id <> c.id or p.method <> _method or p.amount_cents <> _amount_cents or p.tip_cents <> _tip_cents
       or p.tendered_cents is distinct from _tendered_cents then
      raise exception 'idempotency_conflict';
    end if;
    select * into b from public.dining_check_balance(c.id);
    return jsonb_build_object('payment', p.id, 'check_status', c.status, 'balance_cents', b.total_cents - b.paid_cents);
  end if;
  if c.status <> 'open' then raise exception 'check_not_open'; end if;
  select * into s from public.dining_sessions where id = c.session_id;
  if s.status <> 'open' then raise exception 'check_not_open'; end if;
  select * into b from public.dining_check_balance(c.id);
  if b.total_cents = 0 then raise exception 'check_empty'; end if;
  if _amount_cents > b.total_cents - b.paid_cents then
    raise exception 'payment_exceeds_balance' using detail = (b.total_cents - b.paid_cents)::text;
  end if;
  if _tendered_cents is not null then chg := _tendered_cents - _amount_cents - _tip_cents; end if;
  insert into public.dining_check_payments (org_id, location_id, check_id, method, amount_cents, tip_cents,
    tendered_cents, change_cents, client_key, created_by)
  values (_org_id, _location_id, c.id, _method, _amount_cents, _tip_cents, _tendered_cents, chg, k, auth.uid())
  returning id into pid;
  perform public.write_audit(_org_id, 'tables.check_paid', pid::text,
    jsonb_build_object('check', c.id, 'method', _method, 'amount_cents', _amount_cents, 'tip_cents', _tip_cents));
  if b.paid_cents + _amount_cents = b.total_cents then
    perform public.dining_close_paid_check_internal(c.id);
    return jsonb_build_object('payment', pid, 'check_status', 'closed', 'balance_cents', 0);
  end if;
  return jsonb_build_object('payment', pid, 'check_status', 'open',
    'balance_cents', b.total_cents - b.paid_cents - _amount_cents);
end $$;

-- ---------------------------------------------------------------- reverse a tender (open check only)
create or replace function public.void_check_payment(
  _org_id uuid,
  _location_id uuid,
  _payment_id uuid,
  _reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  why text := btrim(coalesce(_reason, ''));
  p public.dining_check_payments;
  c public.dining_checks;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'orders.refund', _location_id);
  if length(why) not between 3 and 300 then raise exception 'reason_required'; end if;
  select * into p from public.dining_check_payments
   where id = _payment_id and org_id = _org_id and location_id = _location_id;
  if p.id is null then raise exception 'payment_not_found'; end if;
  select * into c from public.dining_checks where id = p.check_id for update;
  select * into p from public.dining_check_payments where id = _payment_id;
  if p.status = 'reversed' then return; end if;
  if c.status <> 'open' then raise exception 'check_not_open'; end if;
  update public.dining_check_payments
     set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = why
   where id = p.id;
  perform public.write_audit(_org_id, 'tables.payment_reversed', p.id::text,
    jsonb_build_object('check', c.id, 'amount_cents', p.amount_cents, 'reason_length', length(why)));
end $$;

-- ---------------------------------------------------------------- move a round to another check
create or replace function public.move_check_round(
  _org_id uuid,
  _location_id uuid,
  _order_id uuid,
  _to_check_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.dining_check_rounds;
  c public.dining_checks;
  src public.dining_checks;
  dst public.dining_checks;
  n integer;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  select * into r from public.dining_check_rounds
   where order_id = _order_id and org_id = _org_id and location_id = _location_id;
  if r.id is null then raise exception 'round_not_found'; end if;
  if r.check_id = _to_check_id then return; end if;
  -- both checks locked in id order
  for c in select * from public.dining_checks
            where id in (r.check_id, _to_check_id) and org_id = _org_id and location_id = _location_id
            order by id for update loop
    if c.id = r.check_id then src := c; else dst := c; end if;
  end loop;
  if dst.id is null then raise exception 'check_not_found'; end if;
  if src.session_id <> dst.session_id then raise exception 'check_other_table'; end if;
  if src.status <> 'open' or dst.status <> 'open' then raise exception 'check_not_open'; end if;
  if exists (select 1 from public.dining_check_payments p
              where p.check_id in (src.id, dst.id) and p.status = 'recorded') then
    raise exception 'check_has_payments';
  end if;
  select * into r from public.dining_check_rounds where id = r.id;
  if r.check_id <> src.id then raise exception 'round_not_found'; end if;
  select coalesce(max(round_no), 0) + 1 into n from public.dining_check_rounds where check_id = dst.id;
  update public.dining_check_rounds set check_id = dst.id, round_no = n where id = r.id;
  perform public.write_audit(_org_id, 'tables.round_moved', _order_id::text,
    jsonb_build_object('from', src.id, 'to', dst.id));
end $$;

-- ---------------------------------------------------------------- cancel: rounds of paid checks
-- The 0018 body, preceded by the check rule (and its lock, taken before the order's: same order as
-- paying). Unchanged for every order that is not a round of a dining check.
CREATE OR REPLACE FUNCTION public.cancel_order_with_reversal(_order_id uuid, _reason text DEFAULT 'Cancelled'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE ord public.orders; m public.inventory_movements; f public.finance_entries; chk public.dining_checks; BEGIN
SELECT c.* INTO chk FROM public.dining_check_rounds r JOIN public.dining_checks c ON c.id=r.check_id WHERE r.order_id=_order_id;
IF chk.id IS NOT NULL THEN
  SELECT * INTO chk FROM public.dining_checks WHERE id=chk.id FOR UPDATE;
END IF;
SELECT * INTO ord FROM public.orders WHERE id=_order_id FOR UPDATE; IF ord.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(ord.org_id,ord.location_id); PERFORM public.assert_permission(ord.org_id,'orders.refund',ord.location_id); IF ord.status='cancelled' THEN RETURN; END IF;
IF chk.id IS NOT NULL AND (chk.status='closed' OR EXISTS(SELECT 1 FROM public.dining_check_payments p WHERE p.check_id=chk.id AND p.status='recorded')) THEN RAISE EXCEPTION 'check_has_payments'; END IF;
FOR m IN SELECT * FROM public.inventory_movements WHERE order_id=_order_id AND kind='sale' ORDER BY inventory_item_id LOOP
UPDATE public.inventory_items SET quantity=quantity-m.delta,updated_at=now() WHERE id=m.inventory_item_id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,order_id,delta,unit_cost_cents,kind,client_event_id,reverses_id,reason,actor_id) VALUES(m.org_id,m.location_id,m.inventory_item_id,_order_id,-m.delta,m.unit_cost_cents,'reversal','reversal:'||_order_id::text,m.id,_reason,auth.uid()); END LOOP;
FOR f IN SELECT * FROM public.finance_entries WHERE order_id=_order_id AND kind IN('revenue','cogs') LOOP INSERT INTO public.finance_entries(org_id,location_id,order_id,kind,amount_cents,client_event_id,reverses_id,description,actor_id) VALUES(f.org_id,f.location_id,_order_id,'reversal_'||f.kind,f.amount_cents,'reversal:'||_order_id::text,f.id,_reason,auth.uid()); END LOOP;
UPDATE public.payments SET status='reversed',reversed_at=now() WHERE order_id=_order_id; UPDATE public.orders SET status='cancelled',updated_at=now() WHERE id=_order_id;
INSERT INTO public.order_status_history(org_id,location_id,order_id,from_status,to_status,actor_id,reason) VALUES(ord.org_id,ord.location_id,_order_id,ord.status,'cancelled',auth.uid(),_reason); PERFORM public.write_audit(ord.org_id,'orders.cancelled',_order_id::text,jsonb_build_object('reason',_reason)); END $function$;

revoke all on function public.pay_dining_check(uuid, uuid, uuid, text, text, integer, integer, integer) from public, anon;
revoke all on function public.void_check_payment(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.move_check_round(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.pay_dining_check(uuid, uuid, uuid, text, text, integer, integer, integer) to authenticated;
grant execute on function public.void_check_payment(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.move_check_round(uuid, uuid, uuid, uuid) to authenticated;

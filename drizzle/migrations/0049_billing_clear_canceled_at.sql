-- 0049: a subscription that is active again no longer carries the date of an old cancellation.
--
-- billing_apply_stripe_event set canceled_at when a subscription was canceled but never cleared it,
-- so an organization that subscribed again kept the old date next to an active subscription. Now
-- canceled_at is cleared when the event makes the subscription active or trialing, and the rows
-- already in that state are fixed. Same signature, grants and behaviour otherwise as in 0048.

UPDATE public.subscriptions SET canceled_at = NULL
WHERE status IN ('active', 'trialing') AND canceled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.billing_apply_stripe_event(_event_id text, _type text, _org_id uuid, _customer text,
  _subscription text, _status text, _plan text, _period_start timestamptz, _period_end timestamptz,
  _cancel_at_period_end boolean, _amount_cents integer, _currency text, _billing_period text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _mapped text;
begin
  insert into public.stripe_webhook_events (id, type, org_id) values (_event_id, _type, _org_id) on conflict (id) do nothing;
  if not found then return false; end if; -- duplicate delivery: no-op
  if not exists (select 1 from public.subscriptions where org_id = _org_id) then raise exception 'unknown_org'; end if;
  _mapped := case _status when 'trialing' then 'trialing' when 'active' then 'active' when 'past_due' then 'past_due'
    when 'incomplete' then 'incomplete' when 'unpaid' then 'unpaid' when 'canceled' then 'canceled'
    when 'incomplete_expired' then 'canceled' else null end;
  update public.subscriptions set
    stripe_customer_id = coalesce(_customer, stripe_customer_id),
    stripe_subscription_id = coalesce(_subscription, stripe_subscription_id),
    plan_id = coalesce((select id from public.billing_plans where id = _plan), plan_id),
    billing_period = case when _billing_period in ('monthly', 'semiannual', 'annual') then _billing_period else billing_period end,
    status = case when _mapped = 'past_due' and status not in ('past_due','grace') then 'grace' else coalesce(_mapped, status) end,
    grace_ends_at = case when _mapped = 'past_due' and status not in ('past_due','grace') then now() + interval '7 days'
                         when _mapped = 'active' then null else grace_ends_at end,
    current_period_start = coalesce(_period_start, current_period_start),
    current_period_end = coalesce(_period_end, current_period_end),
    cancel_at_period_end = coalesce(_cancel_at_period_end, cancel_at_period_end),
    canceled_at = case when _mapped = 'canceled' then now()
                       when _mapped in ('active', 'trialing') then null else canceled_at end,
    updated_at = now()
  where org_id = _org_id;
  if _amount_cents is not null then
    insert into public.billing_events (org_id, kind, amount_cents, currency, status, description, stripe_ref)
    values (_org_id, _type, _amount_cents, coalesce(_currency, 'usd'), _status, _type, _event_id);
  end if;
  update public.stripe_webhook_events set processed_at = now() where id = _event_id;
  perform public.write_audit(_org_id, 'billing.stripe_event', _type,
    jsonb_build_object('event', _event_id, 'status', _status, 'billing_period', _billing_period));
  return true;
end $$;
REVOKE ALL ON FUNCTION public.billing_apply_stripe_event(text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_stripe_event(text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text) TO service_role;

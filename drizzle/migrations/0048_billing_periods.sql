-- 0048: semiannual and annual billing, as sold on the website (website/src/config/pricing.ts).
--
-- Starter and Growth can be paid monthly, every 6 months (8% off the subscription) or yearly (15%
-- off), the 6- and 12-month periods paid upfront and rounded to whole dollars. The implementation fee
-- is never discounted and is charged once. Approved business rules: no refund when a prepaid period
-- is canceled midway; access runs to the end of the paid period.
--
--   Starter  US$ 69/month, US$ 381 every 6 months, US$ 704 a year
--   Growth   US$ 119/month, US$ 657 every 6 months, US$ 1,214 a year
--
-- Additive: two price columns on billing_plans (charge for the whole period; NULL = not offered),
-- the subscription's billing period, and billing_apply_stripe_event gains an optional
-- _billing_period argument (DEFAULT NULL keeps the 12-argument callers working).

ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS semiannual_price_cents integer CHECK (semiannual_price_cents IS NULL OR semiannual_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS annual_price_cents integer CHECK (annual_price_cents IS NULL OR annual_price_cents >= 0);

COMMENT ON COLUMN public.billing_plans.semiannual_price_cents IS
  'Subscription charged every 6 months, upfront, in cents (USD; 8% off); NULL = not offered (0048).';
COMMENT ON COLUMN public.billing_plans.annual_price_cents IS
  'Subscription charged every year, upfront, in cents (USD; 15% off); NULL = not offered (0048).';

UPDATE public.billing_plans SET semiannual_price_cents = 38100, annual_price_cents = 70400 WHERE id = 'starter';
UPDATE public.billing_plans SET semiannual_price_cents = 65700, annual_price_cents = 121400 WHERE id = 'growth';
UPDATE public.billing_plans SET semiannual_price_cents = NULL, annual_price_cents = NULL WHERE id = 'enterprise';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly';
DO $$ BEGIN
  ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_period_chk
    CHECK (billing_period IN ('monthly', 'semiannual', 'annual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.subscriptions.billing_period IS
  'monthly | semiannual | annual: how often the subscription is charged, set by the Stripe webhook (0048).';

DROP FUNCTION IF EXISTS public.billing_apply_stripe_event(text,text,uuid,text,text,text,text,timestamptz,timestamptz,boolean,integer,text);

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
    canceled_at = case when _mapped = 'canceled' then now() else canceled_at end,
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

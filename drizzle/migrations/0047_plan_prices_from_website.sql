-- 0047: plan prices = the website's approved prices (website/src/config/pricing.ts).
--
-- The website sells a flat monthly subscription per plan, with a store limit, plus a one-time
-- implementation fee: Starter US$ 69/month + US$ 149 (1 location), Growth US$ 119/month +
-- US$ 399.99 (up to 3 locations), Enterprise priced by contract with implementation from US$ 799
-- (up to 50 locations). The app still carried placeholder prices per location (US$ 89 / 83).
--
-- New columns (additive): monthly_price_cents (NULL = priced by contract), implementation_fee_cents,
-- implementation_fee_is_minimum ("from" price). price_per_location_cents stays for compatibility and
-- is no longer read by the app; it is set to 0 so nothing can multiply a stale per-location price.
-- Semiannual (8% off) and annual (15% off) billing apply to the subscription only and are set in the
-- billing provider, not here. Not a placeholder any more.

ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS monthly_price_cents integer CHECK (monthly_price_cents IS NULL OR monthly_price_cents >= 0),
  ADD COLUMN IF NOT EXISTS implementation_fee_cents integer NOT NULL DEFAULT 0 CHECK (implementation_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS implementation_fee_is_minimum boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.billing_plans.monthly_price_cents IS
  'Flat monthly subscription of the plan in cents (USD); NULL = priced by contract (0047).';
COMMENT ON COLUMN public.billing_plans.implementation_fee_cents IS
  'One-time implementation fee in cents (USD), never discounted (0047).';
COMMENT ON COLUMN public.billing_plans.implementation_fee_is_minimum IS
  'true: the implementation fee is a starting price, set by contract (0047).';
COMMENT ON COLUMN public.billing_plans.price_per_location_cents IS
  'Legacy per-location price, 0 and unused since 0047; read monthly_price_cents.';

UPDATE public.billing_plans SET
  monthly_price_cents = 6900, implementation_fee_cents = 14900, implementation_fee_is_minimum = false,
  default_store_limit = 1, price_per_location_cents = 0, is_placeholder_pricing = false
WHERE id = 'starter';

UPDATE public.billing_plans SET
  monthly_price_cents = 11900, implementation_fee_cents = 39999, implementation_fee_is_minimum = false,
  default_store_limit = 3, price_per_location_cents = 0, is_placeholder_pricing = false
WHERE id = 'growth';

UPDATE public.billing_plans SET
  monthly_price_cents = NULL, implementation_fee_cents = 79900, implementation_fee_is_minimum = true,
  default_store_limit = 50, price_per_location_cents = 0, is_placeholder_pricing = false
WHERE id = 'enterprise';

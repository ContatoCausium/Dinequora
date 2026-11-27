-- 0040_ai_assistant — the management assistant (AI), behind a feature, with a usage ledger.
--
-- What it adds (additive; nothing changes for any organization when applied):
--   * feature ai_assistant (OFF for every organization until a platform admin turns it on with
--     admin_set_org_feature) and permission assistant.use behind it (owners always; managers by
--     default, derived from the catalog; system profiles org_admin and manager; staff only by grant);
--   * assistant_usage: one row per answered question (who, store scope, model, input/output tokens,
--     time). The question and the answer are NOT stored here (they may hold business details a member
--     typed); the audit gets only that a question was asked and its size;
--   * record_assistant_usage(): written by the server after each answer, as the asking member
--     (assistant.use checked again); assistant_month_tokens(): the organization's tokens this calendar
--     month (UTC), which the server compares with its monthly cap before calling the model.
--
-- The model call itself happens in the app server (src/lib/assistant.functions.ts) with a key that only
-- the server holds; data sent to the model is read through RLS as the asking member, so the assistant
-- never sees more than that member can see. No key configured = the assistant answers
-- "not configured" and nothing is sent anywhere.
--
-- Rollback (a NEW migration): drop the two RPCs and assistant_usage, restore permission_catalog() from
-- 0038, remove assistant.use from the system profiles and feature_permissions, delete the feature row,
-- recompute effective_permissions. See docs/operations/ai-assistant.md.

set local lock_timeout = '5s';

insert into public.feature_catalog (key, description) values
  ('ai_assistant', 'Management assistant: questions about the restaurant answered by an AI model')
on conflict (key) do nothing;
insert into public.feature_permissions (permission, feature) values ('assistant.use', 'ai_assistant')
on conflict (permission) do nothing;

create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund','orders.resolve_pending',
    'kds.view','kds.operate',
    'tables.view','tables.status','tables.serve','tables.manage',
    'menu.view','menu.create','menu.edit','menu.delete',
    'inventory.view','inventory.create','inventory.edit','inventory.adjust','inventory.transfer','inventory.costs',
    'recipes.view','recipes.edit',
    'purchases.view','purchases.create','purchases.approve','purchases.receive','purchases.cancel',
    'suppliers.view','suppliers.edit',
    'finance.view',
    'expenses.view','expenses.create','expenses.edit','expenses.delete','expenses.pay',
    'reports.view','reports.export',
    'assistant.use',
    'team.view','team.invite','team.manage','team.activity',
    'settings.locations','settings.branding','settings.billing'
  ]::text[]
$$;

update public.permission_profiles
   set permissions = array(select distinct p from unnest(permissions || array['assistant.use']) p order by p)
 where is_system and key in ('org_admin','manager')
   and not ('assistant.use' = any(permissions));

update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

create table public.assistant_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  location_id   uuid references public.locations(id) on delete set null,
  user_id       uuid not null,
  model         text not null check (length(model) between 1 and 80),
  input_tokens  integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  question_chars integer not null check (question_chars between 1 and 2000),
  created_at    timestamptz not null default now()
);
create index assistant_usage_org_month on public.assistant_usage (org_id, created_at);

alter table public.assistant_usage enable row level security;
-- Owners see their organization's usage (cost control); a member sees their own rows.
create policy assistant_usage_read on public.assistant_usage for select to authenticated
  using (public.is_org_owner(org_id) or user_id = auth.uid());
revoke all on public.assistant_usage from public, anon, authenticated;
grant select on public.assistant_usage to authenticated;
grant all on public.assistant_usage to service_role;

-- _location_id null = the question was about every store the member can see.
create or replace function public.record_assistant_usage(
  _org_id uuid,
  _model text,
  _input_tokens integer,
  _output_tokens integer,
  _question_chars integer,
  _location_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  perform public.assert_org_operational(_org_id);
  if _location_id is not null and not public.location_in_org(_location_id, _org_id) then
    raise exception 'location_forbidden';
  end if;
  perform public.assert_permission(_org_id, 'assistant.use', _location_id);
  if _model is null or length(_model) not between 1 and 80
     or _input_tokens is null or _input_tokens < 0 or _input_tokens > 5000000
     or _output_tokens is null or _output_tokens < 0 or _output_tokens > 500000
     or _question_chars is null or _question_chars not between 1 and 2000 then
    raise exception 'invalid_usage';
  end if;
  insert into public.assistant_usage (org_id, location_id, user_id, model, input_tokens, output_tokens, question_chars)
  values (_org_id, _location_id, auth.uid(), _model, _input_tokens, _output_tokens, _question_chars);
  perform public.write_audit(_org_id, 'assistant.asked', null,
    jsonb_build_object('question_chars', _question_chars, 'tokens', _input_tokens + _output_tokens));
end $$;

create or replace function public.assistant_month_tokens(_org_id uuid)
returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  perform public.assert_permission(_org_id, 'assistant.use');
  return coalesce((select sum(input_tokens + output_tokens) from public.assistant_usage
                    where org_id = _org_id and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'), 0);
end $$;

revoke all on function public.record_assistant_usage(uuid, text, integer, integer, integer, uuid) from public, anon;
revoke all on function public.assistant_month_tokens(uuid) from public, anon;
grant execute on function public.record_assistant_usage(uuid, text, integer, integer, integer, uuid) to authenticated;
grant execute on function public.assistant_month_tokens(uuid) to authenticated;

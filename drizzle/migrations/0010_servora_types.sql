do $$ begin
  if not exists (select 1 from pg_type where typname='org_role' and typnamespace='public'::regnamespace) then
    create type public.org_role as enum ('owner', 'manager', 'staff');
  end if;
  if not exists (select 1 from pg_type where typname='platform_role' and typnamespace='public'::regnamespace) then
    create type public.platform_role as enum ('platform_admin', 'support');
  end if;
end $$;
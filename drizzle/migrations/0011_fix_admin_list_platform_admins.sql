do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_list_platform_admins'
  ) then
    drop function public.admin_list_platform_admins();
  end if;
end $$;

create function public.admin_list_platform_admins()
returns table(
  user_id uuid,
  email text,
  role public.platform_role
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select
      r.user_id,
      u.email::text,
      r.role
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    order by r.role asc, u.email asc;
end $$;

revoke all on function public.admin_list_platform_admins() from public, anon;
grant execute on function public.admin_list_platform_admins() to authenticated;
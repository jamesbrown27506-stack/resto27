-- A roster membership is valid only while the restaurant itself is active.
--
-- The application uses the service-role key after its own server-side guards,
-- but staff can also reach tables covered by RLS with the authenticated anon
-- client. `staff_role_at()` previously checked only restaurant_staff.status,
-- so a valid access token retained direct menu/reservation access after the
-- platform suspended the restaurant.

create or replace function public.staff_role_at(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.role
  from public.restaurant_staff s
  join public.restaurants r on r.id = s.restaurant_id
  where s.restaurant_id = target
    and s.profile_id = public.current_profile_id()
    and s.status = 'active'
    and r.status = 'active'
  limit 1;
$$;

comment on function public.staff_role_at(uuid) is
  'Current profile role at an active restaurant; suspended or pending restaurants grant no staff access.';

-- Verification: the definition must contain the restaurant status predicate.
select pg_get_functiondef('public.staff_role_at(uuid)'::regprocedure);

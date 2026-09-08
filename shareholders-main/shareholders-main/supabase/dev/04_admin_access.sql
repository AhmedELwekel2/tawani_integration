-- Admin read/write access, for the disposable dev project.
--
-- 01_schema.sql reconstructs the portal's tables but deliberately omits
-- `is_portal_admin()`, so the only policies present are the shareholder-facing
-- ones ("you may read your own row"). That leaves the admin panel reading zero
-- rows: the Dashboard, Stockholders, Transactions and Dividends tabs all come up
-- empty even for a genuine admin.
--
-- This creates the missing function and the admin policies so the panel works
-- against this project. Production already has both -- do not run this there.

-- ---------------------------------------------------------------------------
-- is_portal_admin()
-- ---------------------------------------------------------------------------
-- Simplified next to production's, which also enforces the session-age window.
-- Here it is purely the JWT claim, which is what the admin panel already checks
-- client-side.
create or replace function public.is_portal_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'portal_admin')::boolean,
    false
  );
$$;

grant execute on function public.is_portal_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin policies
-- ---------------------------------------------------------------------------
-- One "admins may do anything" policy per admin-managed table. RLS policies are
-- OR-ed, so the existing shareholder-facing policies keep working unchanged.
do $$
declare
  target text;
begin
  foreach target in array array[
    'stockholders',
    'stockholder_transactions',
    'yearly_dividends',
    'stock_certificates',
    'announcements',
    'contact_submissions',
    'feedback',
    'feedback_questions',
    'feedback_responses',
    'feedback_answers',
    'subscribers'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = target
    ) then
      execute format('drop policy if exists %I on public.%I', target || '_admin_all', target);
      execute format(
        'create policy %I on public.%I for all to authenticated '
        'using (public.is_portal_admin()) with check (public.is_portal_admin())',
        target || '_admin_all', target
      );
      execute format('grant select, insert, update, delete on public.%I to authenticated', target);
    end if;
  end loop;
end $$;

-- Storage: admins upload certificates and announcement files.
drop policy if exists storage_admin_all on storage.objects;
create policy storage_admin_all on storage.objects
  for all to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());

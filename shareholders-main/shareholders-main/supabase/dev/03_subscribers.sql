-- Subscribers, for the disposable dev project.
--
-- Same table as supabase/migrations/20260908160000_subscribers_and_roles.sql, but
-- the admin-write policy is relaxed: `is_portal_admin()` does not exist here (see
-- the note in 01_schema.sql), so any authenticated session may write. Fine for a
-- throwaway project seeded with fictional people; against production run the
-- migration instead.
--
-- Ends with two seeded subscribers so the subscriber login path can be exercised.

create table if not exists public.subscribers (
  id            uuid primary key default gen_random_uuid(),
  national_id   text not null unique,
  full_name_ar  text,
  full_name_en  text,
  email         text,
  phone_number  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz default now()
);

create index if not exists subscribers_active_idx on public.subscribers (is_active);

alter table public.subscribers enable row level security;

drop policy if exists subscribers_select_own on public.subscribers;
create policy subscribers_select_own on public.subscribers
  for select to authenticated
  using (national_id = public.current_national_id());

-- Dev-only write access, for the case where this file is run before
-- 04_admin_access.sql has created `is_portal_admin()`.
--
-- Split across the three write commands ON PURPOSE. A single `FOR ALL USING
-- (true)` also covers SELECT, and because RLS policies are OR-ed that would
-- override `subscribers_select_own` and let any signed-in subscriber read the
-- whole directory. Reads stay governed by the two SELECT policies alone.
drop policy if exists subscribers_dev_write on public.subscribers;
drop policy if exists subscribers_dev_insert on public.subscribers;
drop policy if exists subscribers_dev_update on public.subscribers;
drop policy if exists subscribers_dev_delete on public.subscribers;

create policy subscribers_dev_insert on public.subscribers
  for insert to authenticated with check (true);
create policy subscribers_dev_update on public.subscribers
  for update to authenticated using (true) with check (true);
create policy subscribers_dev_delete on public.subscribers
  for delete to authenticated using (true);

grant select, insert, update, delete on public.subscribers to authenticated;

alter table public.feedback
  add column if not exists subscriber_id uuid references public.subscribers(id) on delete set null;

alter table public.feedback_responses
  add column if not exists subscriber_id uuid references public.subscribers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
-- 2000000001 is the one to test with; 2000000002 is inactive, so it exercises the
-- refused-login path the same way stockholder 1000000003 does.
insert into public.subscribers (national_id, full_name_ar, full_name_en, email, phone_number, is_active)
values
  ('2000000001', 'نورة الشمري',  'Noura Al-Shammari', 'noura@example.com', '+966500000011', true),
  ('2000000002', 'ماجد القحطاني', 'Majed Al-Qahtani',  'majed@example.com', '+966500000012', false)
on conflict (national_id) do nothing;

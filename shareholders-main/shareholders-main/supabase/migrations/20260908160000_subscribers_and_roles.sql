-- Subscribers (المشترك) and the four-role model.
--
-- A subscriber consumes published content -- announcements, tourism news and
-- reports -- but holds no shares, so none of the financial tables reference this
-- table. It carries only what authentication needs (a national ID to log in with
-- and a phone to receive the OTP) plus a name to greet them by.
--
-- Roles themselves live in the JWT as `app_metadata.role`
-- ('admin' | 'editor' | 'shareholder' | 'subscriber'); `auth-login` stamps it.
-- Admins additionally keep `portal_admin: true` so every existing
-- `public.is_portal_admin()` policy continues to work untouched.

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

-- A signed-in subscriber may read only their own row. Uses the same
-- `current_national_id()` helper every stockholder-facing policy uses, so the
-- two directories resolve identity identically.
drop policy if exists subscribers_select_own on public.subscribers;
create policy subscribers_select_own on public.subscribers
  for select to authenticated
  using (national_id = public.current_national_id());

-- Admins manage the directory. Editors deliberately get nothing here: they
-- produce content and have no business reading the member list.
drop policy if exists subscribers_admin_all on public.subscribers;
create policy subscribers_admin_all on public.subscribers
  for all to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());

grant select on public.subscribers to authenticated;
grant insert, update, delete on public.subscribers to authenticated;

-- ---------------------------------------------------------------------------
-- Feedback attribution
-- ---------------------------------------------------------------------------
-- Subscribers get the same notes section shareholders have. The existing
-- `stockholder_id` is already nullable, so a subscriber's submission would land
-- anonymous; this column keeps it attributable without conflating the two.
alter table public.feedback
  add column if not exists subscriber_id uuid references public.subscribers(id) on delete set null;

alter table public.feedback_responses
  add column if not exists subscriber_id uuid references public.subscribers(id) on delete set null;

-- Announcements need no change: `announcements_select_published` already grants
-- select to every authenticated user, which now includes subscribers.

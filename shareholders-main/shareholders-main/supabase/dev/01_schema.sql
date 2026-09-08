/* ============================================================================
   Stockholder Portal — reconstructed base schema for a LOCAL / DEV project
   ============================================================================

   This file is NOT a dump of production. It was reconstructed by reading what
   the application code actually queries (see supabase/migrations/README.md —
   the real base schema was never committed and lives only in the hosted
   database). Column names, types and RLS policies here are chosen to satisfy
   the portal's queries; production may differ in details.

   Scope: the shareholder-facing portal. Admin-only objects used by the separate
   admin panel (audit_log, stockholder_transaction_approvals,
   v_stockholder_transactions_search, is_portal_admin()) are NOT included.

   Apply to a fresh Supabase project via the SQL editor, then run 02_seed.sql.
   ============================================================================ */

-- ---------------------------------------------------------------------------
-- Helper: the national_id of the calling user, taken from the JWT.
-- auth-login stamps it into app_metadata (and user_metadata as a fallback).
-- ---------------------------------------------------------------------------
create or replace function public.current_national_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'national_id', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'national_id', '')
  );
$$;

-- ---------------------------------------------------------------------------
-- stockholders
-- ---------------------------------------------------------------------------
create table if not exists public.stockholders (
  id                        uuid primary key default gen_random_uuid(),
  national_id               text not null unique,
  full_name_ar              text,
  full_name_en              text,
  email                     text,
  phone_number              text,
  birth_date_hijri          text,
  birth_date_gregorian      date,
  birth_place               text,
  address_building          text,
  address_street            text,
  address_district          text,
  address_city              text,
  address_postal_code       text,
  address_additional_number text,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz default now()
);

alter table public.stockholders enable row level security;

-- A signed-in stockholder may read only their own row.
create policy stockholders_select_own on public.stockholders
  for select to authenticated
  using (national_id = public.current_national_id());

-- ---------------------------------------------------------------------------
-- stockholder_transactions
-- ---------------------------------------------------------------------------
create table if not exists public.stockholder_transactions (
  id                              uuid primary key default gen_random_uuid(),
  stockholder_id                  uuid not null references public.stockholders(id) on delete cascade,
  transaction_type                text not null check (transaction_type in ('purchase', 'sell')),
  shares                          integer not null,
  price_per_share                 numeric(12, 2),
  total_amount                    numeric(14, 2),
  transaction_date                date not null,
  notes                           text,
  approval_document_storage_path  text,
  approval_document_name          text,
  created_at                      timestamptz not null default now()
);

create index if not exists stockholder_transactions_stockholder_idx
  on public.stockholder_transactions (stockholder_id, transaction_date desc, created_at desc);

alter table public.stockholder_transactions enable row level security;

create policy stockholder_transactions_select_own on public.stockholder_transactions
  for select to authenticated
  using (
    stockholder_id in (
      select id from public.stockholders
      where national_id = public.current_national_id()
    )
  );

-- ---------------------------------------------------------------------------
-- yearly_dividends
-- ---------------------------------------------------------------------------
create table if not exists public.yearly_dividends (
  id             uuid primary key default gen_random_uuid(),
  stockholder_id uuid not null references public.stockholders(id) on delete cascade,
  year           integer not null,
  amount         numeric(14, 2) not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (stockholder_id, year)
);

alter table public.yearly_dividends enable row level security;

create policy yearly_dividends_select_own on public.yearly_dividends
  for select to authenticated
  using (
    stockholder_id in (
      select id from public.stockholders
      where national_id = public.current_national_id()
    )
  );

-- ---------------------------------------------------------------------------
-- stock_certificates
-- ---------------------------------------------------------------------------
create table if not exists public.stock_certificates (
  id             uuid primary key default gen_random_uuid(),
  stockholder_id uuid not null references public.stockholders(id) on delete cascade,
  transaction_id uuid references public.stockholder_transactions(id) on delete set null,
  file_url       text not null,
  storage_path   text,
  file_name      text not null,
  uploaded_at    timestamptz not null default now(),
  uploaded_by    uuid
);

alter table public.stock_certificates enable row level security;

create policy stock_certificates_select_own on public.stock_certificates
  for select to authenticated
  using (
    stockholder_id in (
      select id from public.stockholders
      where national_id = public.current_national_id()
    )
  );

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id                           uuid primary key default gen_random_uuid(),
  title_ar                     text not null,
  title_en                     text not null,
  body_ar                      text,
  body_en                      text,
  pdf_storage_path             text,
  pdf_file_name                text,
  cover_image_url              text,
  cover_image_path             text,
  is_published                 boolean not null default false,
  published_at                 timestamptz,
  notification_sent_at         timestamptz,
  notification_recipient_count integer,
  created_by                   uuid,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

alter table public.announcements enable row level security;

-- The portal selects all announcements and relies on RLS to hide drafts.
create policy announcements_select_published on public.announcements
  for select to authenticated
  using (is_published = true);

-- ---------------------------------------------------------------------------
-- feedback_questions / feedback_responses / feedback_answers  (survey)
-- ---------------------------------------------------------------------------
create table if not exists public.feedback_questions (
  id            uuid primary key default gen_random_uuid(),
  question_ar   text not null,
  question_en   text,
  question_type text not null check (question_type in ('rating', 'text')),
  category_ar   text,
  category_en   text,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.feedback_questions enable row level security;

create policy feedback_questions_select_active on public.feedback_questions
  for select to authenticated
  using (is_active = true);

create table if not exists public.feedback_responses (
  id             uuid primary key default gen_random_uuid(),
  stockholder_id uuid references public.stockholders(id) on delete set null,
  overall_rating numeric(4, 2),
  created_at     timestamptz not null default now()
);

alter table public.feedback_responses enable row level security;

-- Signed-in users may submit; the insert returns only the new id.
create policy feedback_responses_insert on public.feedback_responses
  for insert to authenticated
  with check (true);

create policy feedback_responses_select_own on public.feedback_responses
  for select to authenticated
  using (
    stockholder_id in (
      select id from public.stockholders
      where national_id = public.current_national_id()
    )
  );

create table if not exists public.feedback_answers (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references public.feedback_responses(id) on delete cascade,
  question_id  uuid not null references public.feedback_questions(id) on delete cascade,
  rating_value integer,
  text_value   text,
  created_at   timestamptz not null default now()
);

alter table public.feedback_answers enable row level security;

create policy feedback_answers_insert on public.feedback_answers
  for insert to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- feedback  (legacy table, still written by submitFeedback())
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  stockholder_id uuid references public.stockholders(id) on delete set null,
  rating         integer,
  category       text,
  message        text,
  created_at     timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- contact_submissions
-- ---------------------------------------------------------------------------
create table if not exists public.contact_submissions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text,
  phone_number text,
  subject      text,
  message      text not null,
  status       text not null default 'new',
  created_at   timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;

create policy contact_submissions_insert on public.contact_submissions
  for insert to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- otp_verification_codes  (email OTP path; service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.otp_verification_codes (
  id          uuid primary key default gen_random_uuid(),
  national_id text not null,
  code        text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists otp_verification_codes_lookup_idx
  on public.otp_verification_codes (national_id, code, expires_at desc);

-- RLS on with no policies: only the service role (edge functions) can touch it.
alter table public.otp_verification_codes enable row level security;

-- ---------------------------------------------------------------------------
-- request_rate_limits  (service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.request_rate_limits (
  id         uuid primary key default gen_random_uuid(),
  action     text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists request_rate_limits_lookup_idx
  on public.request_rate_limits (action, identifier, created_at desc);

alter table public.request_rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- device_tokens  (push notifications; service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.device_tokens (
  id             uuid primary key default gen_random_uuid(),
  stockholder_id uuid references public.stockholders(id) on delete cascade,
  token          text not null unique,
  platform       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.device_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- PostgREST connects as anon/authenticated, so those roles need table
-- privileges before RLS is even consulted -- without them every query fails
-- with "permission denied" rather than simply returning no rows. Supabase's
-- "Automatically expose new tables" project setting normally handles this via
-- default privileges; granting explicitly here means the schema also works when
-- that setting is off.
--
-- RLS still decides which rows are visible; these grants only open the door.
-- The service-role-only tables are deliberately excluded.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  public.stockholders,
  public.stockholder_transactions,
  public.yearly_dividends,
  public.stock_certificates,
  public.announcements,
  public.feedback_questions
to authenticated;

grant select on public.feedback_responses to authenticated;

grant insert on
  public.contact_submissions,
  public.feedback,
  public.feedback_responses,
  public.feedback_answers
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets (private; the portal mints signed URLs for these)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('stock-certificates',  'stock-certificates',  false),
  ('announcement-files',  'announcement-files',  false),
  ('announcement-covers', 'announcement-covers', true)
on conflict (id) do nothing;

-- Signed-in users may read objects in the private buckets. Signed URLs are
-- minted client-side, so the authenticated role needs select on the objects.
create policy storage_read_certificates on storage.objects
  for select to authenticated
  using (bucket_id = 'stock-certificates');

create policy storage_read_announcement_files on storage.objects
  for select to authenticated
  using (bucket_id = 'announcement-files');

create policy storage_read_announcement_covers on storage.objects
  for select to public
  using (bucket_id = 'announcement-covers');

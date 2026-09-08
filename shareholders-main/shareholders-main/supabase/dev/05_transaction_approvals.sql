-- Transaction approval documents, for the disposable dev project.
--
-- 01_schema.sql is a reconstruction and this table was missed, but the admin
-- panel embeds it in every transaction query:
--
--   TRANSACTION_LIST_SELECT = '*, stockholder_transaction_approvals ( storage_path, file_name )'
--
-- PostgREST rejects the whole request when the relationship does not exist
-- (PGRST200), so its absence broke the Dashboard and Transactions tabs outright
-- -- not just the approval-document column. Production already has this table.
--
-- `transaction_id` is unique because the upload path upserts on it: one approval
-- document per transaction, replaced rather than accumulated.

create table if not exists public.stockholder_transaction_approvals (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique
                 references public.stockholder_transactions(id) on delete cascade,
  storage_path   text not null,
  file_name      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz default now()
);

alter table public.stockholder_transaction_approvals enable row level security;

-- Admin-only, matching production: these are internal approval records, not
-- something a shareholder sees in the portal.
drop policy if exists stockholder_transaction_approvals_admin_all
  on public.stockholder_transaction_approvals;
create policy stockholder_transaction_approvals_admin_all
  on public.stockholder_transaction_approvals
  for all to authenticated
  using (public.is_portal_admin())
  with check (public.is_portal_admin());

grant select, insert, update, delete
  on public.stockholder_transaction_approvals to authenticated;

-- Private bucket the documents live in.
insert into storage.buckets (id, name, public)
values ('approval-documents', 'approval-documents', false)
on conflict (id) do nothing;

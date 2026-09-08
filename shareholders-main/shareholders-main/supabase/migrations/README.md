# Database migrations

Until 2026-07-27 the schema for this project existed **only inside the hosted
Supabase database** — there was not a single `.sql` file anywhere in the repo,
so ~60 migrations were invisible to code review, `git blame` and any new
contributor.

From here on, every migration applied to the project should also be committed
here, named `<version>_<name>.sql` to match the row it creates in
`supabase_migrations.schema_migrations`.

These files are a **record of what was applied**, not a build step — migrations
are applied through the Supabase MCP `apply_migration` tool (or the CLI). To
confirm the repo matches the database:

```sql
select version, name from supabase_migrations.schema_migrations order by version desc;
```

Earlier migrations are not backfilled here; they can be exported from
`supabase_migrations.schema_migrations.statements` if that becomes worthwhile.

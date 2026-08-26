create table if not exists public.system_heartbeat (
  id text primary key check (id = 'main'),
  last_seen_at timestamptz not null default now(),
  source text not null default 'vercel-cron',
  updated_at timestamptz not null default now()
);

alter table public.system_heartbeat enable row level security;

revoke all on table public.system_heartbeat from anon, authenticated;
grant all on table public.system_heartbeat to service_role;

insert into public.system_heartbeat (id, last_seen_at, source, updated_at)
values ('main', now(), 'migration', now())
on conflict (id) do update set
  last_seen_at = excluded.last_seen_at,
  source = excluded.source,
  updated_at = excluded.updated_at;

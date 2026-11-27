-- GlycoVision: medicines, and where a blood sugar reading came from.
-- Run AFTER 2026-11-23_fitness.sql, once, in Supabase:
-- SQL Editor -> New query -> paste -> Run.
-- Safe to run twice. Nothing is deleted.

-- manual = typed in; health_connect = from a meter or sensor.
alter table public.bg_readings add column if not exists source text not null default 'manual';

create table if not exists public.medicines (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dose text,
  -- Times of day, like {"08:00","20:00"}; empty = only when needed.
  times text[] not null default '{}',
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists medicines_user on public.medicines (user_id);

create table if not exists public.medicine_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  medicine_id bigint not null references public.medicines(id) on delete cascade,
  day date not null,
  time text not null,
  status text not null check (status in ('taken','skipped')),
  logged_at timestamptz not null default now(),
  primary key (medicine_id, day, time)
);
create index if not exists medicine_logs_user_day on public.medicine_logs (user_id, day);

alter table public.medicines enable row level security;
alter table public.medicine_logs enable row level security;
drop policy if exists "own medicines" on public.medicines;
create policy "own medicines" on public.medicines for select using (auth.uid() = user_id);
drop policy if exists "own medicine logs" on public.medicine_logs;
create policy "own medicine logs" on public.medicine_logs for select using (auth.uid() = user_id);

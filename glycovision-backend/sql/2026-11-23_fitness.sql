-- GlycoVision: fitness (steps, distance, Heart Points, sleep, vitals, goals).
-- Run AFTER 2026-11-23_health_flow.sql, once, in Supabase:
-- SQL Editor -> New query -> paste -> Run.
-- Safe to run twice. Nothing is deleted.

alter table public.profiles add column if not exists step_goal int check (step_goal between 1000 and 40000);
alter table public.profiles add column if not exists heart_goal int check (heart_goal between 30 and 600);

-- More kinds of 5-minute data from Health Connect.
alter table public.health_samples drop constraint if exists health_samples_kind_check;
alter table public.health_samples add constraint health_samples_kind_check
  check (kind in ('steps','heart_rate','active_kcal','distance_m','move_min','heart_pts'));

-- One row per day, for week and month charts.
create table if not exists public.health_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  steps int,
  distance_m numeric,
  active_kcal numeric,
  move_min int,
  heart_pts int,
  active_hours int,
  longest_sit_min int,
  hr_min int,
  hr_max int,
  hr_resting int,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Sleep and workouts recorded by a watch or another app.
create table if not exists public.health_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sleep','exercise')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  title text,
  deep_min int,
  rem_min int,
  awake_min int,
  primary key (user_id, kind, start_time),
  check (end_time > start_time)
);

-- Weight, blood pressure, HbA1c and sleep typed in by hand or read from Health Connect.
create table if not exists public.vitals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('weight','blood_pressure','hba1c','sleep')),
  value numeric not null check (value > 0),
  value2 numeric check (value2 > 0),
  source text not null default 'manual',
  logged_at timestamptz not null default now(),
  unique (user_id, kind, logged_at)
);

-- Live workouts save their steps, distance and calories.
alter table public.activity_logs add column if not exists steps int check (steps >= 0);
alter table public.activity_logs add column if not exists distance_m numeric check (distance_m >= 0);
alter table public.activity_logs add column if not exists kcal numeric check (kcal >= 0);

alter table public.health_daily enable row level security;
alter table public.health_sessions enable row level security;
alter table public.vitals enable row level security;
drop policy if exists "own health days" on public.health_daily;
create policy "own health days" on public.health_daily for select using (auth.uid() = user_id);
drop policy if exists "own health sessions" on public.health_sessions;
create policy "own health sessions" on public.health_sessions for select using (auth.uid() = user_id);
drop policy if exists "own vitals" on public.vitals;
create policy "own vitals" on public.vitals for select using (auth.uid() = user_id);

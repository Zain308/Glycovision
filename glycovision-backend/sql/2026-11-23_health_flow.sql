-- GlycoVision: body details, health data and activity (supervisor's flow).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run twice. Nothing is deleted.

alter table public.profiles add column if not exists sex text check (sex in ('male','female'));
alter table public.profiles add column if not exists birth_year int check (birth_year between 1900 and 2100);
alter table public.profiles add column if not exists height_cm numeric check (height_cm between 80 and 250);
alter table public.profiles add column if not exists weight_kg numeric check (weight_kg between 15 and 350);
-- Does a doctor prescribe insulin at meals? Decides whether a dose is shown.
alter table public.profiles add column if not exists mealtime_insulin boolean;
alter table public.profiles add column if not exists insulin_type text check (insulin_type in ('rapid','regular','premixed','other'));
alter table public.profiles add column if not exists disclaimer_accepted_at timestamptz;

-- Steps, heart rate and calories in 5-minute buckets (Health Connect).
create table if not exists public.health_samples (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('steps','heart_rate','active_kcal')),
  bucket_start timestamptz not null,
  value numeric not null check (value >= 0),
  primary key (user_id, kind, bucket_start)
);

-- Activity typed in by hand.
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null,
  minutes int not null check (minutes between 1 and 600),
  logged_at timestamptz not null default now()
);
create index if not exists activity_logs_user_time on public.activity_logs (user_id, logged_at desc);

-- Row level security: the app's public key cannot read these tables. Only
-- the signed-in owner can, and the backend (service role).
alter table public.health_samples enable row level security;
alter table public.activity_logs enable row level security;
drop policy if exists "own health samples" on public.health_samples;
create policy "own health samples" on public.health_samples for select using (auth.uid() = user_id);
drop policy if exists "own activity" on public.activity_logs;
create policy "own activity" on public.activity_logs for select using (auth.uid() = user_id);

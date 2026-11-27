-- GlycoVision: entries made without internet are uploaded later, exactly once.
-- Run AFTER 2026-11-24_care.sql, once, in Supabase:
-- SQL Editor -> New query -> paste -> Run.
-- Safe to run twice. Nothing is deleted.

alter table public.bg_readings   add column if not exists client_id uuid;
alter table public.meals         add column if not exists client_id uuid;
alter table public.bolus_logs    add column if not exists client_id uuid;
alter table public.activity_logs add column if not exists client_id uuid;
alter table public.vitals        add column if not exists client_id uuid;

create unique index if not exists bg_readings_client   on public.bg_readings   (user_id, client_id);
create unique index if not exists meals_client         on public.meals         (user_id, client_id);
create unique index if not exists bolus_logs_client    on public.bolus_logs    (user_id, client_id);
create unique index if not exists activity_logs_client on public.activity_logs (user_id, client_id);
create unique index if not exists vitals_client        on public.vitals        (user_id, client_id);

-- Let the API see the new columns right away.
notify pgrst, 'reload schema';

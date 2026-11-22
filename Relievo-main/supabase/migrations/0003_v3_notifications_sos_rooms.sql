-- Relievo v3: notifications, SOS (flag + private audio), priority override, and a `kind` on chat rooms.
-- Idempotent: safe to run more than once. No destructive changes (no data is dropped or rewritten).

-- ---------- incidents: SOS flag and coordinator priority override ----------
alter table public.incidents add column if not exists is_sos boolean not null default false;
alter table public.incidents add column if not exists sos_status text;               -- 'active' | 'cancelled' | null
alter table public.incidents add column if not exists sos_approximate boolean not null default false;
alter table public.incidents add column if not exists priority_override text;       -- 'low' | 'medium' | 'high' | 'critical' | null

-- ---------- incident_channels: several rooms per incident (operations + citizen) ----------
alter table public.incident_channels add column if not exists kind text not null default 'operations';
do $$
begin
  -- the original primary key was (incident_id) alone; make it (incident_id, kind) so one incident can have two rooms
  if exists (
    select 1 from pg_constraint
    where conname = 'incident_channels_pkey' and conrelid = 'public.incident_channels'::regclass and array_length(conkey, 1) = 1
  ) then
    alter table public.incident_channels drop constraint incident_channels_pkey;
    alter table public.incident_channels add primary key (incident_id, kind);
  end if;
end $$;

-- ---------- notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.users (id) on delete cascade,
  recipient_role text,                                   -- informational: the role the notification was addressed to
  type text not null,                                    -- new_incident | sos | sos_audio | sos_cancelled | priority_alert | assignment_offer | volunteer_accepted | volunteer_declined | escalation | hub_alert
  priority text not null default 'medium',               -- low | medium | high | critical
  incident_id uuid references public.incidents (id) on delete cascade,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
alter table public.notifications enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_own_select') then
    create policy notifications_own_select on public.notifications for select using (recipient_user_id = auth.uid());
  end if;
end $$;

-- ---------- SOS audio: private, size-capped by the backend, readable only through the backend ----------
create table if not exists public.sos_audio (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  mime text not null,
  duration_s numeric not null default 0,
  size_bytes integer not null,
  transcript text not null default '',
  data_base64 text not null,
  created_at timestamptz not null default now()
);
alter table public.sos_audio enable row level security;   -- no policies on purpose: only the backend (service role) can read it

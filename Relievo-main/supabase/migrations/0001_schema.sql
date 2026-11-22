-- ReliefRelay schema. Supabase (Postgres) is the source of truth; Nexconn only carries chat.
-- Run in the Supabase SQL editor (or `supabase db push`), then run `npm run seed:supabase -w backend`.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text unique,                              -- copy of the Auth email, used for the demo role switcher
  role text not null check (role in ('citizen', 'volunteer', 'coordinator', 'ngo')),
  phone text,
  verified boolean not null default false,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.volunteer_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  skills text[] not null default '{}',
  qualifications text[] not null default '{}',   -- e.g. 'medical', 'rescue_certified'
  availability text not null default 'available' check (availability in ('available', 'busy', 'offline')),
  capacity int not null default 1 check (capacity >= 1),
  lat double precision not null,
  lng double precision not null
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  verification_status text not null default 'pending' check (verification_status in ('verified', 'pending')),
  is_synthetic boolean not null default false
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id),
  original_text text not null,              -- never overwritten
  title text not null,
  category text not null check (category in ('medical', 'food', 'water', 'shelter', 'rescue', 'other')),
  urgency text not null check (urgency in ('low', 'medium', 'high', 'critical')),
  people_affected int,
  needs text[] not null default '{}',
  vulnerable_persons text[] not null default '{}',
  lat double precision not null,
  lng double precision not null,
  address_text text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'verified', 'assigned', 'in_progress', 'resolved', 'rejected')),
  reject_reason text,
  possible_duplicate_of uuid references public.incidents (id),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.incident_ai_analysis (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  extracted_data jsonb not null,
  confidence numeric not null,
  model_version text not null,
  source text not null check (source in ('openrouter', 'gemini', 'fallback', 'mock'))  -- which provider answered
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  volunteer_id uuid not null references public.users (id),
  assigned_by uuid not null references public.users (id),
  status text not null check (status in ('approved', 'accepted', 'declined', 'reassigned', 'completed')),
  score_breakdown jsonb,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
-- At most one active (approved or accepted) assignment per incident.
create unique index assignments_one_active_per_incident
  on public.assignments (incident_id) where status in ('approved', 'accepted');

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  resource_type text not null check (resource_type in ('food', 'water', 'medicine', 'shelter')),
  name text not null,
  quantity int not null check (quantity >= 0),
  unit text not null,
  lat double precision not null,
  lng double precision not null
);

create table public.resource_allocations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  resource_id uuid not null references public.resources (id),
  allocated_quantity int not null check (allocated_quantity > 0),
  allocated_by uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  actor_id uuid references public.users (id),   -- null = system
  action text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index incident_events_incident_idx on public.incident_events (incident_id, created_at);

create table public.incident_channels (
  incident_id uuid primary key references public.incidents (id) on delete cascade,
  nexconn_channel_id text not null unique
);

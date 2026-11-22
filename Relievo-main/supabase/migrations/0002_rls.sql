-- Minimal Row Level Security. The backend uses the service-role key (bypasses RLS) and enforces
-- the same rules in code; RLS protects any direct client access with the anon key.
--   citizens see their own incidents; volunteers see their own assignments; coordinators see all.

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

alter table public.users enable row level security;
alter table public.volunteer_profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_ai_analysis enable row level security;
alter table public.assignments enable row level security;
alter table public.resources enable row level security;
alter table public.resource_allocations enable row level security;
alter table public.incident_events enable row level security;
alter table public.incident_channels enable row level security;

create policy users_read on public.users for select
  using (id = auth.uid() or public.current_role_name() = 'coordinator');

create policy volunteer_profiles_read on public.volunteer_profiles for select
  using (user_id = auth.uid() or public.current_role_name() = 'coordinator');
create policy volunteer_profiles_update_own on public.volunteer_profiles for update
  using (user_id = auth.uid());

create policy organisations_read on public.organisations for select using (auth.uid() is not null);

-- incidents: own (citizen), assigned (volunteer), all (coordinator)
create policy incidents_read on public.incidents for select using (
  reporter_id = auth.uid()
  or public.current_role_name() = 'coordinator'
  or exists (select 1 from public.assignments a
             where a.incident_id = incidents.id and a.volunteer_id = auth.uid()
               and a.status in ('approved', 'accepted', 'completed'))
);
create policy incidents_insert_own on public.incidents for insert with check (reporter_id = auth.uid());
create policy incidents_coordinator_update on public.incidents for update
  using (public.current_role_name() = 'coordinator');

-- Tables hanging off an incident are readable exactly when the incident is readable.
create policy analysis_read on public.incident_ai_analysis for select
  using (exists (select 1 from public.incidents i where i.id = incident_id));
create policy events_read on public.incident_events for select
  using (exists (select 1 from public.incidents i where i.id = incident_id));
create policy channels_read on public.incident_channels for select
  using (public.current_role_name() = 'coordinator'
         or exists (select 1 from public.assignments a
                    where a.incident_id = incident_channels.incident_id
                      and a.volunteer_id = auth.uid() and a.status in ('approved', 'accepted')));

create policy assignments_read on public.assignments for select
  using (volunteer_id = auth.uid() or public.current_role_name() = 'coordinator');

create policy resources_read on public.resources for select using (auth.uid() is not null);
create policy allocations_read on public.resource_allocations for select
  using (public.current_role_name() in ('coordinator', 'ngo'));

-- No insert/update policies on events, assignments, channels, allocations: only the backend (service role) writes them.

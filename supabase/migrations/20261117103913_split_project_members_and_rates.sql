-- migration: split project_rates into project_members and project_rates
-- purpose: membership lives in public.project_members (including the responsible
--   manager, same as the old project_rates rows); public.project_rates keeps only the
--   rate and is created/removed with each membership row. projects.manager_id stays.
-- affected objects: table public.project_members (new); public.project_rates (fk to
--   members); private.is_project_manager(uuid), private.is_project_member(uuid),
--   private.accessible_project_ids(); public.add_project_manager_membership(),
--   public.ensure_project_member_rate(); public.create_project(...),
--   public.get_project_people(); policies on public.project_members and
--   public.project_rates; insert and delete on public.project_rates revoked from
--   authenticated, and update limited to the rate column (rates follow membership
--   rows); update on public.project_members withheld (a membership row is only
--   inserted or deleted); public.get_project_members() dropped (membership is read
--   via project_members rls / nested select)
-- special risks: membership writes move from project_rates to project_members; app code
--   that still inserts into project_rates for membership will fail until updated.
--   existing (project_id, user_id) pairs are copied into project_members.

-- ---------------------------------------------------------------------------
-- project_members
-- ---------------------------------------------------------------------------

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

comment on table public.project_members is
  'people assigned to a project, including the responsible manager (also on projects.manager_id)';

-- covers lookups by user_id that return project_id (accessible_project_ids) as index-only scans
create index project_members_user_id_idx on public.project_members (user_id) include (project_id);

create trigger set_project_members_updated_at
  before update on public.project_members
  for each row execute function public.trigger_set_updated_at();

alter table public.project_members enable row level security;

create policy "require secure session"
  on public.project_members
  as restrictive
  for all
  using ((select private.is_secure()))
  with check ((select private.is_secure()));

grant all on table public.project_members to service_role;
-- update is withheld: the row is its key, so membership changes are insert and delete
grant select, insert, delete on table public.project_members to authenticated;

-- safety: copy every current assignment, including the responsible manager
insert into public.project_members (project_id, user_id, created_at, updated_at)
select pr.project_id, pr.user_id, pr.created_at, pr.updated_at
from public.project_rates pr
on conflict (project_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- project_rates: rates only, always tied to a member
-- ---------------------------------------------------------------------------

-- safety: replace project/user fks with a composite fk to project_members so a rate
-- cannot exist without membership; deleting a member removes its rate.
alter table public.project_rates
  drop constraint project_rates_project_id_fkey;

alter table public.project_rates
  drop constraint project_rates_user_id_fkey;

alter table public.project_rates
  add constraint project_rates_member_fkey
  foreign key (project_id, user_id)
  references public.project_members (project_id, user_id)
  on delete cascade;

comment on table public.project_rates is
  'hourly rate for a project member; created and removed with the membership row';

-- security definer justification: every member must have a rate row (default 0), including
-- when membership is written by other security definer triggers; only inserts the matching
-- (project_id, user_id) pair.
create or replace function public.ensure_project_member_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_rates (project_id, user_id)
  values (new.project_id, new.user_id)
  on conflict (project_id, user_id) do nothing;

  return new;
end;
$$;

create trigger ensure_project_member_rate
  after insert on public.project_members
  for each row execute function public.ensure_project_member_rate();

revoke execute on function public.ensure_project_member_rate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- access helpers: membership from project_members
-- ---------------------------------------------------------------------------

-- security definer justification: policies on project_rates and trackers need to know who
-- manages a project, while the projects select policy itself reads project_members; reading
-- both tables past rls here keeps the policies from recursing into each other.
create or replace function private.is_project_manager(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.manager_id = (select auth.uid())
  )
  or (
    (select private.is_manager_or_admin())
    and exists (
      select 1
      from public.project_members pm
      where pm.project_id = target_project_id
        and pm.user_id = (select auth.uid())
    )
  );
$$;

comment on function private.is_project_manager(uuid) is
  'true when the caller is responsible for the project, or a manager/admin assigned to it';

-- security definer justification: the projects select policy needs the caller's own
-- membership; reading project_members past rls avoids recursion with its select policy.
create or replace function private.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = (select auth.uid())
  );
$$;

comment on function private.is_project_member(uuid) is 'true when the caller is assigned to the project';

-- security definer justification: project_members select must list every member on the
-- caller's projects without per-row helper calls and without recursing into its own rls;
-- reading project_members past rls returns the caller's project id set once for the policy.
create or replace function private.accessible_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pm.project_id
  from public.project_members pm
  where pm.user_id = (select auth.uid());
$$;

comment on function private.accessible_project_ids() is
  'project ids the caller is assigned to (for membership select rls; admins are gated in the policy)';

revoke execute on function private.accessible_project_ids() from public, anon;
grant execute on function private.accessible_project_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- responsible person membership trigger (same duplication as the old project_rates path)
-- ---------------------------------------------------------------------------

-- security definer justification: a manager may create a project for another manager or
-- hand theirs over; the responsible person's membership (and a creating manager's, when
-- they name someone else) must be written even though the caller may not manage the
-- project yet. it only ever inserts those (project, person) pairs. the rate row is added
-- by ensure_project_member_rate.
create or replace function public.add_project_manager_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_id is not null then
    insert into public.project_members (project_id, user_id)
    values (new.id, new.manager_id)
    on conflict (project_id, user_id) do nothing;
  end if;

  if tg_op = 'INSERT'
    and (select private.jwt_role()) = 'manager'
    and (select auth.uid()) is distinct from new.manager_id then
    insert into public.project_members (project_id, user_id)
    values (new.id, (select auth.uid()))
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- project_members policies
-- ---------------------------------------------------------------------------

-- initplan: is_admin() and accessible_project_ids() run once per statement
create policy "project_members_select_visible"
  on public.project_members
  for select
  to authenticated
  using (
    (select private.is_admin())
    or project_id in (select private.accessible_project_ids())
  );

create policy "project_members_insert_management"
  on public.project_members
  for insert
  to authenticated
  with check (
    (select private.is_admin())
    or ((select private.is_manager_or_admin()) and (select private.is_project_manager(project_id)))
  );

-- no update policy: rewriting project_id or user_id would move the membership, and the
-- rate row with it. update is not granted to authenticated.

-- the responsible person always stays a member; a policy (not a trigger) so deleting the
-- project still cascades to every membership once the projects row is gone
create policy "project_members_delete_management"
  on public.project_members
  for delete
  to authenticated
  using (
    (
      (select private.is_admin())
      or ((select private.is_manager_or_admin()) and (select private.is_project_manager(project_id)))
    )
    and not exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.manager_id = user_id
    )
  );

-- ---------------------------------------------------------------------------
-- project_rates policies: rates only (membership deletes live on project_members)
-- ---------------------------------------------------------------------------

-- safety: rates are created only by ensure_project_member_rate and removed only by the fk
-- cascade from project_members (both bypass rls). authenticated may read a visible rate
-- and change only its rate column; the key columns stay with the membership row.
drop policy if exists "project_rates_insert_management" on public.project_rates;
drop policy if exists "project_rates_delete_management" on public.project_rates;

revoke insert, update, delete on table public.project_rates from authenticated;
grant update (rate) on table public.project_rates to authenticated;

-- ---------------------------------------------------------------------------
-- rpc: create, people and members
-- ---------------------------------------------------------------------------

create or replace function public.create_project(
  project_name text,
  responsible_id uuid,
  project_client text default '',
  project_note text default null,
  manager_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_project_id uuid := pg_catalog.gen_random_uuid();
begin
  -- no returning: rls would check visibility of the new row before the trigger has added
  -- a creating manager to the project
  insert into public.projects (id, name, client, note, manager_id)
  values (new_project_id, project_name, coalesce(project_client, ''), project_note, responsible_id);

  -- the responsible person and a creating manager were added by the projects trigger
  insert into public.project_members (project_id, user_id)
  select new_project_id, manager_id
  from unnest(coalesce(manager_ids, '{}')) as manager_id
  where manager_id is distinct from responsible_id
  on conflict (project_id, user_id) do nothing;

  return new_project_id;
end;
$$;

comment on function public.create_project(text, uuid, text, text, uuid[]) is
  'creates a project with its responsible person and extra members in one transaction';

-- security definer justification: public.users and public.user_access only expose a
-- staff member's own row and project_rates only the caller's own rates, yet project pages
-- must show who manages and works on a project. this returns the minimum profile fields
-- (no email or phone) plus system role and access status, for admins/managers everyone,
-- and for everyone else only the people who share a project with the caller.
create or replace function public.get_project_people()
returns table (
  id uuid,
  first_name text,
  last_name text,
  role public.user_role,
  positions jsonb,
  is_confirmed boolean,
  is_blocked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible_projects as (
    select p.id, p.manager_id
    from public.projects p
    where p.manager_id = (select auth.uid())
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p.id
          and pm.user_id = (select auth.uid())
      )
  )
  select u.id, u.first_name, u.last_name, ua.role, u.positions, ua.is_confirmed, ua.is_blocked
  from public.users u
  join public.user_access ua on ua.user_id = u.id
  where (select private.is_secure())
    and (select auth.uid()) is not null
    and (
      (select private.is_manager_or_admin())
      or u.id = (select auth.uid())
      or exists (select 1 from visible_projects vp where vp.manager_id = u.id)
      or exists (
        select 1
        from public.project_members pm
        join visible_projects vp on vp.id = pm.project_id
        where pm.user_id = u.id
      )
    );
$$;

comment on function public.get_project_people() is
  'people visible on project pages: everyone for admins/managers, otherwise people sharing a project with the caller';

-- safety: membership is readable through public.project_members rls and nested selects;
-- the security definer helper from 20261112120000 is no longer used by the app
drop function if exists public.get_project_members();

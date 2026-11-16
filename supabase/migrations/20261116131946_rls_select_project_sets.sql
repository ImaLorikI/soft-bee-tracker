-- migration: evaluate project visibility once per statement
-- purpose: select policies on projects, project_rates and trackers called
--   private.is_project_member(id) / private.is_project_manager(project_id) for every
--   row. those helpers take a row column, so postgres cannot cache them. replace the
--   select checks with a set of project ids for the caller (rls guide: filter the row
--   column with in (...), and wrap the fixed lookup in select so it runs once).
--   the project_rates delete check joined public.projects as the caller; move that
--   read into a security definer helper so it does not depend on projects rls.
-- affected objects: functions private.member_project_ids(), private.managed_project_ids(),
--   private.is_project_responsible_person(uuid, uuid); policies projects_select_visible,
--   project_rates_select_visible, project_rates_delete_management,
--   trackers_select_own_or_management.
-- special risks: drop policy replaces the select (and one delete) expressions.
--   who may see or delete a row does not change: admins still see every row; everyone
--   else still sees their own rows and, for managers, rows on projects they are
--   responsible for or assigned to. write policies stay on the per-row helpers.
--   security definer justification is on each function below. the functions stay in
--   private, which is not an api schema, and execute is revoked from public and anon.

-- ---------------------------------------------------------------------------
-- set helpers
-- ---------------------------------------------------------------------------

-- security definer justification: the projects select policy needs the caller's
-- project_rates rows. reading them here skips project_rates rls, which itself reads
-- projects, so the two policies cannot recurse. the set does not depend on the
-- projects row being checked, so the policy can evaluate it once.
create or replace function private.member_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.project_id
  from public.project_rates pr
  where pr.user_id = (select auth.uid());
$$;

comment on function private.member_project_ids() is
  'project ids the caller is assigned to; empty when auth.uid() is null';

-- security definer justification: rate and tracker select policies need the caller's
-- managed projects, which are stored on public.projects and public.project_rates.
-- reading both here skips their rls and avoids the projects <-> project_rates loop.
create or replace function private.managed_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.projects p
  where p.manager_id = (select auth.uid())
  union
  select pr.project_id
  from public.project_rates pr
  where (select private.is_manager_or_admin())
    and pr.user_id = (select auth.uid());
$$;

comment on function private.managed_project_ids() is
  'project ids the caller is responsible for, plus assignments when the caller is a manager or admin';

-- security definer justification: deleting a project_rate must know whether that user
-- is the project's responsible person. an invoker exists() on public.projects would
-- run the projects select policy from inside a project_rates policy.
-- the caller gate matches who may delete a rate. a direct call from anyone else
-- returns false, so the helper does not reveal another project's responsible person.
create or replace function private.is_project_responsible_person(target_project_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      (select private.is_admin())
      or (select private.is_project_manager(target_project_id))
    )
    and exists (
      select 1
      from public.projects p
      where p.id = target_project_id
        and p.manager_id = target_user_id
    );
$$;

comment on function private.is_project_responsible_person(uuid, uuid) is
  'true when the caller may manage the project and target_user_id is its responsible person';

revoke execute on function private.member_project_ids() from public, anon;
revoke execute on function private.managed_project_ids() from public, anon;
revoke execute on function private.is_project_responsible_person(uuid, uuid) from public, anon;

grant execute on function private.member_project_ids() to authenticated, service_role;
grant execute on function private.managed_project_ids() to authenticated, service_role;
grant execute on function private.is_project_responsible_person(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- select policies: same visibility, set-based checks
-- ---------------------------------------------------------------------------

-- safety: replaces the select expression only. admins still see every project;
-- everyone else still sees projects they are responsible for or assigned to.
drop policy "projects_select_visible" on public.projects;

create policy "projects_select_visible"
  on public.projects
  for select
  to authenticated
  using (
    (select private.is_admin())
    or manager_id = (select auth.uid())
    or id in (select * from private.member_project_ids())
  );

-- safety: replaces the select expression only. own rates, admin, and a manager's
-- rates on projects they manage stay visible. other rates stay hidden.
drop policy "project_rates_select_visible" on public.project_rates;

create policy "project_rates_select_visible"
  on public.project_rates
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or (
      (select private.is_manager_or_admin())
      and project_id in (select * from private.managed_project_ids())
    )
  );

-- safety: replaces the using expression only. the responsible person's rate still
-- cannot be deleted; project delete still cascades every rate. the helper takes
-- the rate's project and user, so it stays correlated and is not cached per statement.
drop policy "project_rates_delete_management" on public.project_rates;

create policy "project_rates_delete_management"
  on public.project_rates
  for delete
  to authenticated
  using (
    (
      (select private.is_admin())
      or (
        (select private.is_manager_or_admin())
        and (select private.is_project_manager(project_id))
      )
    )
    and not (select private.is_project_responsible_person(project_id, user_id))
  );

-- safety: replaces the select expression only. staff still see their own entries;
-- managers still see entries on projects they manage; admins still see every entry.
drop policy "trackers_select_own_or_management" on public.trackers;

create policy "trackers_select_own_or_management"
  on public.trackers
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or (
      (select private.is_manager_or_admin())
      and project_id in (select * from private.managed_project_ids())
    )
  );

begin;

select plan(37);

-- seeded: admin a01, manager a02 (responsible for the seeded projects), worker a03.
-- two more managers are added here.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-00000000f002', 'manager2@access.test', '{"username": "manager-two"}'),
  ('00000000-0000-0000-0000-00000000f003', 'manager3@access.test', '{"username": "manager-three"}');

update public.user_access set role = 'manager'
where user_id in ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f003');

-- the local database may hold projects beyond the seed, so totals are read up front
create temp table project_totals on commit drop as select count(*)::int + 3 as total from public.projects;
grant select on project_totals to authenticated;

set local role authenticated;

-- manager 1 creates a project and makes manager 2 responsible for it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated","user_role":"manager"}', true);

select lives_ok(
  $$insert into public.projects (id, name, manager_id)
    values ('00000000-0000-0000-0000-00000000fb01', 'Handed over', '00000000-0000-0000-0000-00000000f002')$$,
  'a manager can create a project with another manager responsible'
);

select is(
  (select array_agg(user_id order by user_id)::text from public.project_members
   where project_id = '00000000-0000-0000-0000-00000000fb01'),
  '{00000000-0000-0000-0000-000000000a02,00000000-0000-0000-0000-00000000f002}',
  'the responsible manager and the creating manager are both on the project'
);

select is(
  (select count(*)::int from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'),
  1,
  'a creating manager who is only a member sees only their own rate'
);

-- responsible manager sees every rate on the project
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f002","role":"authenticated","user_role":"manager"}', true);

select is(
  (select count(*)::int from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'),
  2,
  'membership trigger also creates a rate row for each member'
);

select is(
  (select bool_and(rate is null) from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'),
  true,
  'a new membership leaves the rate unset'
);

-- creating manager continues project edits
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated","user_role":"manager"}', true);

select is(
  (select manager_id::text from public.projects where id = '00000000-0000-0000-0000-00000000fb01'),
  '00000000-0000-0000-0000-00000000f002',
  'the creator sees the project and exactly one person stays responsible'
);

update public.projects set note = 'scope' where id = '00000000-0000-0000-0000-00000000fb01';

select is(
  (select note from public.projects where id = '00000000-0000-0000-0000-00000000fb01'),
  'scope',
  'the creating manager can still edit the project'
);

select lives_ok(
  $$insert into public.project_members (project_id, user_id)
    values ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-000000000a03')$$,
  'the creating manager can add members'
);

-- rate visibility and edits: responsible manager only (not a member-only manager)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f002","role":"authenticated","user_role":"manager"}', true);

select is(
  (select count(*)::int from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'
     and user_id = '00000000-0000-0000-0000-000000000a03'),
  1,
  'adding a member also creates their rate row'
);

select throws_ok(
  $$delete from public.project_rates
    where project_id = '00000000-0000-0000-0000-00000000fb01'
      and user_id = '00000000-0000-0000-0000-000000000a03'$$,
  '42501',
  null,
  'rates cannot be deleted directly'
);

select throws_ok(
  $$insert into public.project_rates (project_id, user_id, rate)
    values ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-000000000a03', 10)$$,
  '42501',
  null,
  'rates cannot be inserted directly'
);

update public.project_rates set rate = 55
where project_id = '00000000-0000-0000-0000-00000000fb01'
  and user_id = '00000000-0000-0000-0000-000000000a03';

select is(
  (select rate from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'
     and user_id = '00000000-0000-0000-0000-000000000a03'),
  55.00::numeric,
  'the responsible manager can update a member rate'
);

update public.project_rates set rate = 0
where project_id = '00000000-0000-0000-0000-00000000fb01'
  and user_id = '00000000-0000-0000-0000-000000000a03';

select is(
  (select rate from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb01'
     and user_id = '00000000-0000-0000-0000-000000000a03'),
  0.00::numeric,
  'zero is a stored rate, distinct from an unset rate'
);

select throws_ok(
  $$update public.project_rates set user_id = '00000000-0000-0000-0000-00000000f003'
    where project_id = '00000000-0000-0000-0000-00000000fb01'
      and user_id = '00000000-0000-0000-0000-000000000a03'$$,
  '42501',
  null,
  'a rate row can only change its rate'
);

-- creating manager resumes membership and project checks
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated","user_role":"manager"}', true);

select throws_ok(
  $$update public.project_members set user_id = '00000000-0000-0000-0000-00000000f003'
    where project_id = '00000000-0000-0000-0000-00000000fb01'
      and user_id = '00000000-0000-0000-0000-000000000a03'$$,
  '42501',
  null,
  'membership cannot be updated'
);

select throws_ok(
  $$update public.projects set manager_id = '00000000-0000-0000-0000-000000000a03'
    where id = '00000000-0000-0000-0000-00000000fb01'$$,
  '23514',
  null,
  'staff cannot be responsible for a project'
);

select throws_ok(
  $$update public.projects set manager_id = null where id = '00000000-0000-0000-0000-00000000fb01'$$,
  '42501',
  null,
  'a project always keeps a responsible person'
);

select lives_ok(
  $$insert into public.trackers (date, duration_minutes, project_id)
    values (current_date, 45, '00000000-0000-0000-0000-00000000fb01')$$,
  'an assigned manager can log time on the project'
);

select is(
  (select count(*)::int from public.projects
   where manager_id <> (select auth.uid()) and not private.is_project_member(id)),
  0,
  'a manager sees only projects they are responsible for or assigned to'
);

-- create_project: one call for the project, its responsible person and the chosen managers
create temp table created_project on commit drop as
select public.create_project(
  'Created with managers',
  '00000000-0000-0000-0000-00000000f002',
  'Acme',
  null,
  array['00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-000000000a01']::uuid[]
) as id;

select is(
  (select count(*)::int from public.project_members pm where pm.project_id = (select id from created_project)),
  4,
  'create_project adds the responsible person, the creator and the chosen managers and admins'
);

select is(
  (select client from public.projects where name = 'Created with managers'),
  'Acme',
  'create_project saves the project fields'
);

select throws_ok(
  $$select public.create_project(
      'Staff responsible',
      '00000000-0000-0000-0000-000000000a03',
      '',
      null,
      array['00000000-0000-0000-0000-00000000f003']::uuid[]
    )$$,
  '23514',
  null,
  'create_project refuses staff as the responsible person'
);

select is(
  (select count(*)::int from public.projects where name = 'Staff responsible'),
  0,
  'a refused create_project leaves no project behind'
);

-- manager 2, the responsible manager, sees the team's time
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f002","role":"authenticated","user_role":"manager"}', true);

select is(
  (select count(*)::int from public.trackers where project_id = '00000000-0000-0000-0000-00000000fb01'),
  1,
  'the responsible manager sees time logged by other members'
);

-- manager 3 was only added as a member of 'Created with managers'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f003","role":"authenticated","user_role":"manager"}', true);

update public.projects set note = 'by member manager' where id = (select id from created_project);

select is(
  (select note from public.projects where id = (select id from created_project)),
  'by member manager',
  'a manager added as a member can edit the project because of their role'
);

select is(
  (select count(*)::int from public.projects where id = '00000000-0000-0000-0000-00000000fb01'),
  0,
  'a manager outside the project does not see it'
);

update public.projects set note = 'outsider' where id = '00000000-0000-0000-0000-00000000fb01';

select throws_ok(
  $$insert into public.project_members (project_id, user_id)
    values ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-00000000f003')$$,
  '42501',
  null,
  'a manager outside the project cannot add members'
);

select is(
  (select count(*)::int from public.project_members where project_id = '00000000-0000-0000-0000-00000000fb01'),
  0,
  'membership rows follow the same visibility'
);

-- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated","user_role":"admin"}', true);

select is(
  (select note from public.projects where id = '00000000-0000-0000-0000-00000000fb01'),
  'scope',
  'the outsider''s edit did not touch the project'
);

select lives_ok(
  $$insert into public.projects (id, name, manager_id)
    values ('00000000-0000-0000-0000-00000000fb02', 'Admin made', '00000000-0000-0000-0000-00000000f003')$$,
  'an admin can create a project for a manager'
);

select is(
  (select count(*)::int from public.project_members where project_id = '00000000-0000-0000-0000-00000000fb02'),
  1,
  'an admin who creates a project for someone else is not added to it'
);

delete from public.project_members
where project_id = '00000000-0000-0000-0000-00000000fb02'
  and user_id = '00000000-0000-0000-0000-00000000f003';

select is(
  (select count(*)::int from public.project_members where project_id = '00000000-0000-0000-0000-00000000fb02'),
  1,
  'the responsible person cannot be removed from the project'
);

insert into public.project_members (project_id, user_id)
values ('00000000-0000-0000-0000-00000000fb02', '00000000-0000-0000-0000-000000000a03');

delete from public.project_members
where project_id = '00000000-0000-0000-0000-00000000fb02'
  and user_id = '00000000-0000-0000-0000-000000000a03';

select is(
  (select count(*)::int from public.project_rates
   where project_id = '00000000-0000-0000-0000-00000000fb02'
     and user_id = '00000000-0000-0000-0000-000000000a03'),
  0,
  'removing a member also removes their rate'
);

select is((select count(*)::int from public.projects), (select total from project_totals), 'an admin sees every project');

-- staff: a03 was added as a member of 'Handed over'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated","user_role":"worker"}', true);

update public.projects set note = 'by staff' where id = '00000000-0000-0000-0000-00000000fb01';

select is(
  (select note from public.projects where id = '00000000-0000-0000-0000-00000000fb01'),
  'scope',
  'staff assigned to a project cannot edit it because of their role'
);

select throws_ok(
  $$insert into public.project_members (project_id, user_id)
    values ('00000000-0000-0000-0000-00000000fb01', '00000000-0000-0000-0000-00000000f003')$$,
  '42501',
  null,
  'staff assigned to a project cannot add members'
);

select is(
  (select count(*)::int from public.projects
   where manager_id is distinct from (select auth.uid()) and not private.is_project_member(id)),
  0,
  'staff see only the projects they are assigned to'
);

select * from finish();

rollback;

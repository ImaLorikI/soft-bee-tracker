begin;

select plan(24);

-- seeded: admin a01, manager a02 (responsible for b01), worker a03 (assigned to b01).
-- entries are written as a trusted session in the current (open) month
insert into public.trackers (id, date, duration_minutes, project_id, user_id)
values
  ('00000000-0000-0000-0000-00000000e001', current_date, 60, '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a03'),
  ('00000000-0000-0000-0000-00000000e002', current_date, 60, '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a03'),
  ('00000000-0000-0000-0000-00000000e003', current_date, 60, '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a03'),
  ('00000000-0000-0000-0000-00000000e004', current_date, 60, '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a02'),
  ('00000000-0000-0000-0000-00000000e005', current_date, 60, '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01');

insert into public.trackers (id, date, duration_minutes, is_live, live_status, start_live_date, project_id, user_id)
values
  ('00000000-0000-0000-0000-00000000e006', current_date, 0, true, 'start', now(), '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a03');

set local role authenticated;

-- worker
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated","user_role":"worker"}', true);

select throws_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e003'$$,
  '42501',
  null,
  'a worker cannot approve an entry'
);

select throws_ok(
  $$update public.trackers set status = 'rejected', review_note = 'no' where id = '00000000-0000-0000-0000-00000000e003'$$,
  '42501',
  null,
  'a worker cannot reject an entry'
);

select throws_ok(
  $$insert into public.trackers (date, duration_minutes, project_id, status)
    values (current_date, 30, '00000000-0000-0000-0000-000000000b01', 'approved')$$,
  '23514',
  null,
  'a worker cannot log an entry as already approved'
);

select lives_ok(
  $$update public.trackers
    set reviewed_by = '00000000-0000-0000-0000-000000000a03', reviewed_at = now(), review_note = 'forged'
    where id = '00000000-0000-0000-0000-00000000e003'$$,
  'a worker update that touches review data still succeeds'
);

select is(
  (select row(reviewed_by, reviewed_at, review_note)::text from public.trackers where id = '00000000-0000-0000-0000-00000000e003'),
  row(null::uuid, null::timestamptz, null::text)::text,
  'review data cannot be forged without a review'
);

-- manager of b01
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated","user_role":"manager"}', true);

select lives_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e001'$$,
  'a manager can approve a staff entry on their project'
);

select is(
  (select row(status, reviewed_by, reviewed_at is not null, review_note)::text from public.trackers where id = '00000000-0000-0000-0000-00000000e001'),
  row('approved'::public.tracker_status, '00000000-0000-0000-0000-000000000a02'::uuid, true, null::text)::text,
  'approval stamps the reviewer and time'
);

select throws_ok(
  $$update public.trackers set status = 'rejected' where id = '00000000-0000-0000-0000-00000000e002'$$,
  '23514',
  'Add a reason to reject this time entry.',
  'rejecting needs a reason'
);

select throws_ok(
  $$update public.trackers set status = 'rejected', review_note = '   ' where id = '00000000-0000-0000-0000-00000000e002'$$,
  '23514',
  'Add a reason to reject this time entry.',
  'a blank reason is not a reason'
);

select lives_ok(
  $$update public.trackers set status = 'rejected', review_note = '  Wrong project  ' where id = '00000000-0000-0000-0000-00000000e002'$$,
  'a manager can reject a staff entry with a reason'
);

select is(
  (select row(status, reviewed_by, review_note)::text from public.trackers where id = '00000000-0000-0000-0000-00000000e002'),
  row('rejected'::public.tracker_status, '00000000-0000-0000-0000-000000000a02'::uuid, 'Wrong project')::text,
  'rejection stores the trimmed reason and the reviewer'
);

select throws_ok(
  $$update public.trackers set status = 'rejected', review_note = 'changed my mind' where id = '00000000-0000-0000-0000-00000000e001'$$,
  '23514',
  'Undo the current review before changing it.',
  'an approved entry cannot jump straight to rejected'
);

select throws_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e004'$$,
  '42501',
  'You cannot review your own time entries.',
  'a manager cannot approve their own entry'
);

select throws_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e005'$$,
  '42501',
  'Only an admin can review this time entry.',
  'a manager cannot approve an admin entry'
);

select throws_ok(
  $$update public.trackers set status = 'approved', duration_minutes = 600 where id = '00000000-0000-0000-0000-00000000e003'$$,
  '23514',
  'A review cannot change the entry itself.',
  'a review cannot carry other edits'
);

select throws_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e006'$$,
  '23514',
  'A running timer cannot be reviewed.',
  'a running timer cannot be approved'
);

select lives_ok(
  $$update public.trackers set status = 'new' where id = '00000000-0000-0000-0000-00000000e001'$$,
  'a manager can undo an approval'
);

select is(
  (select row(status, reviewed_by, reviewed_at)::text from public.trackers where id = '00000000-0000-0000-0000-00000000e001'),
  row('new'::public.tracker_status, null::uuid, null::timestamptz)::text,
  'undo clears the review data'
);

-- worker again: the undone entry is open, the rejected one is locked
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a03","role":"authenticated","user_role":"worker"}', true);

select lives_ok(
  $$update public.trackers set duration_minutes = 90 where id = '00000000-0000-0000-0000-00000000e001'$$,
  'a worker can edit an entry after its review was undone'
);

update public.trackers set duration_minutes = 5 where id = '00000000-0000-0000-0000-00000000e002';

select is(
  (select duration_minutes from public.trackers where id = '00000000-0000-0000-0000-00000000e002'),
  60,
  'a worker cannot edit a rejected entry'
);

-- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated","user_role":"admin"}', true);

select lives_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e004'$$,
  'an admin can approve a manager entry'
);

select lives_ok(
  $$update public.trackers set status = 'approved' where id = '00000000-0000-0000-0000-00000000e005'$$,
  'an admin can approve their own entry'
);

select lives_ok(
  $$update public.trackers set status = 'new' where id = '00000000-0000-0000-0000-00000000e002'$$,
  'an admin can undo another reviewer''s rejection'
);

select is(
  (select review_note from public.trackers where id = '00000000-0000-0000-0000-00000000e002'),
  null,
  'undoing a rejection clears its reason'
);

select * from finish();

rollback;

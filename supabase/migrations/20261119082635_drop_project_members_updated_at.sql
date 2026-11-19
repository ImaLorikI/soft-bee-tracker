-- migration: drop project_members.updated_at
-- purpose: a membership row is only inserted or deleted, so updated_at is unused.
--   databases that already applied an earlier revision of
--   20261117103913_split_project_members_and_rates still have the column and trigger.
-- affected objects: column public.project_members.updated_at,
--   trigger set_project_members_updated_at on public.project_members
-- special risks: destructive. the timestamps are unused and are discarded.

-- safety: no policy, function, or query reads project_members.updated_at.
-- if exists: a fresh replay of the create migration no longer adds the column.
drop trigger if exists set_project_members_updated_at on public.project_members;

alter table public.project_members
  drop column if exists updated_at;

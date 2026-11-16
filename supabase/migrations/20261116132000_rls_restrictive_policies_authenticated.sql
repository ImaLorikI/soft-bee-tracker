-- migration: scope restrictive session policies to authenticated
-- purpose: the permissive policies on these tables are already `to authenticated`.
--   the restrictive "require secure session" policies had no role list, so they ran
--   for every role, including anon. anon has no grants here; skipping the check
--   matches the rls guide (use the to option instead of auth.uid() to reject anon)
--   and the avatars policies, which are already `to authenticated`.
-- affected objects: policy "require secure session" on public.projects,
--   public.project_rates, public.trackers, public.leave_requests, public.leave_allowances.
-- special risks: the policy no longer applies to roles other than authenticated.
--   anon still cannot read these tables (no grants, and no permissive policy).
--   service_role bypasses rls. public.users and public.user_access stay
--   `to anon, authenticated` so supabase_auth_admin is not gated by is_secure().

-- safety: changes the role list only. using and with check stay
--   `(select private.is_secure())`. no rows are touched.
alter policy "require secure session" on public.projects to authenticated;
alter policy "require secure session" on public.project_rates to authenticated;
alter policy "require secure session" on public.trackers to authenticated;
alter policy "require secure session" on public.leave_requests to authenticated;
alter policy "require secure session" on public.leave_allowances to authenticated;

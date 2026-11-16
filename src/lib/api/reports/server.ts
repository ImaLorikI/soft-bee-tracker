import 'server-only';

import { getSessionViewer, type SessionViewer } from '@/lib/api/auth/viewer';
import { mapProjectMemberRows, mapProjectsRowsToProjects, PROJECT_COLUMNS, toProjectRecords } from '@/lib/api/projects/mappers';
import { buildVisibleProjectsFilter } from '@/lib/api/projects/visible-projects';
import type { ReportRangeInput, ReportSource } from '@/lib/api/reports/types';
import { mapProjectPersonRows } from '@/lib/api/users/mappers';
import { createServerClient } from '@/lib/supabase/server';
import type { ApiError } from '@/types/api-error';

// imported via '@/lib/api/reports/server' (not the barrel) so client bundles never pull in next/headers.
// RLS scopes every read to the viewer: projects they see, people they may name, time and leave they may read.
// Time is summed in the database; the other reads are plain lists and are cut off at the API max_rows (1000).
// Projects and leave also send an explicit filter so the database does not use rls as the only predicate.
export async function getReportSource({ from, to }: ReportRangeInput): Promise<ReportSource> {
  const supabase = await createServerClient();
  const viewer = await getSessionViewer(supabase);

  if (!viewer) {
    throw {
      message: 'Sign in required',
      statusCode: 401
    } satisfies ApiError;
  }

  const [time, leave, projects, members, people] = await Promise.all([
    supabase.rpc('get_report_time', { from_date: from, to_date: to }),
    // approved leave that overlaps the range; working days inside it are counted in buildReport.
    // staff only need their own rows. managers and admins need the team's rows in the range.
    selectReportLeave(supabase, viewer, from, to),
    selectReportProjects(supabase, viewer),
    supabase.rpc('get_project_members'),
    supabase.rpc('get_project_people')
  ]);
  const failed = [time, leave, projects, members, people].find((result) => result.error);

  if (failed?.error) {
    throw {
      message: failed.error.message,
      statusCode: failed.status
    } satisfies ApiError;
  }

  return {
    entries: (time.data ?? []).map((row) => ({ memberId: row.user_id, projectId: row.project_id, minutes: row.minutes })),
    absences: (leave.data ?? []).map((row) => ({
      id: row.id,
      memberId: row.user_id,
      leaveType: row.leave_type,
      startDate: row.start_date,
      endDate: row.end_date
    })),
    people: mapProjectPersonRows(people.data ?? []),
    projects: toProjectRecords(mapProjectsRowsToProjects(projects.data ?? []), mapProjectMemberRows(members.data ?? []))
  };
}

const REPORT_LEAVE_COLUMNS = 'id, user_id, leave_type, start_date, end_date';

type ReportClient = Awaited<ReturnType<typeof createServerClient>>;

function selectReportLeave(supabase: ReportClient, viewer: SessionViewer, from: string, to: string) {
  const overlapping = supabase
    .from('leave_requests')
    .select(REPORT_LEAVE_COLUMNS)
    .eq('status', 'approved')
    .lte('start_date', to)
    .gte('end_date', from);

  if (viewer.role === 'admin' || viewer.role === 'manager') {
    return overlapping;
  }

  return overlapping.eq('user_id', viewer.id);
}

async function selectReportProjects(supabase: ReportClient, viewer: SessionViewer) {
  if (viewer.role === 'admin') {
    return supabase.from('projects').select(PROJECT_COLUMNS);
  }

  const rates = await supabase.from('project_rates').select('project_id').eq('user_id', viewer.id);

  if (rates.error) {
    return { data: null, error: rates.error, status: rates.status };
  }

  const memberProjectIds = [...new Set((rates.data ?? []).map((rate) => rate.project_id))];

  return supabase.from('projects').select(PROJECT_COLUMNS).or(buildVisibleProjectsFilter(viewer.id, memberProjectIds));
}

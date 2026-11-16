import { getSessionViewer } from '@/lib/api/auth/viewer';
import { fetchVisibleProjectIds } from '@/lib/api/projects/visible-projects';
import { createBrowserClient } from '@/lib/supabase/client';
import type { ApiError } from '@/types/api-error';

import { mapProjectRateRowsToProjectRates, PROJECT_RATE_COLUMNS } from './mappers';
import type { ProjectRate } from './types';

// admins read every rate. managers read rates on projects they can see.
// everyone else reads only their own row, matching project_rates select rls.
export async function getProjectRates(): Promise<ProjectRate[]> {
  const supabase = createBrowserClient();
  const viewer = await getSessionViewer(supabase);

  if (!viewer) {
    return [];
  }

  if (viewer.role === 'admin') {
    return readProjectRates(supabase.from('project_rates').select(PROJECT_RATE_COLUMNS));
  }

  if (viewer.role === 'manager') {
    const projectIds = await fetchVisibleProjectIds(supabase, viewer.id);

    if (projectIds.length === 0) {
      return [];
    }

    return readProjectRates(supabase.from('project_rates').select(PROJECT_RATE_COLUMNS).in('project_id', projectIds));
  }

  return readProjectRates(supabase.from('project_rates').select(PROJECT_RATE_COLUMNS).eq('user_id', viewer.id));
}

async function readProjectRates(query: PromiseLike<ProjectRateQuery>): Promise<ProjectRate[]> {
  const { data, error, status } = await query;

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapProjectRateRowsToProjectRates(data ?? []);
}

interface ProjectRateQuery {
  data: Parameters<typeof mapProjectRateRowsToProjectRates>[0] | null;
  error: { message: string } | null;
  status: number;
}

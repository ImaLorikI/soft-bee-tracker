import type { SupabaseClient } from '@supabase/supabase-js';

import { mapProjectsRowsToProjects, PROJECT_COLUMNS } from '@/lib/api/projects/mappers';
import type { Project } from '@/lib/api/projects/types';
import type { Database } from '@/types';
import type { ApiError } from '@/types/api-error';

type DbClient = SupabaseClient<Database>;

// mirrors projects select rls for anyone who is not an admin:
// responsible (manager_id) or assigned (a row in project_rates).
export function buildVisibleProjectsFilter(userId: string, memberProjectIds: readonly string[]): string {
  if (memberProjectIds.length === 0) {
    return `manager_id.eq.${userId}`;
  }

  return `manager_id.eq.${userId},id.in.(${memberProjectIds.join(',')})`;
}

export async function fetchMemberProjectIds(supabase: DbClient, userId: string): Promise<string[]> {
  const { data, error, status } = await supabase.from('project_rates').select('project_id').eq('user_id', userId);

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return [...new Set((data ?? []).map((rate) => rate.project_id))];
}

export async function fetchVisibleProjectIds(supabase: DbClient, userId: string): Promise<string[]> {
  const memberProjectIds = await fetchMemberProjectIds(supabase, userId);
  const { data, error, status } = await supabase.from('projects').select('id').or(buildVisibleProjectsFilter(userId, memberProjectIds));

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return (data ?? []).map((project) => project.id);
}

export async function fetchVisibleProjects(supabase: DbClient, userId: string): Promise<Project[]> {
  const memberProjectIds = await fetchMemberProjectIds(supabase, userId);
  const { data, error, status } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .or(buildVisibleProjectsFilter(userId, memberProjectIds));

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapProjectsRowsToProjects(data ?? []);
}

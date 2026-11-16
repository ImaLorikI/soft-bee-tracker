'use client';

import { useQuery } from '@tanstack/react-query';

import { getSessionViewer } from '@/lib/api/auth/viewer';
import { mapProjectMemberRows, mapProjectsRowsToProjects, PROJECT_COLUMNS, toProjectRecords } from '@/lib/api/projects/mappers';
import type { MemberProject, Project, ProjectMember, ProjectRecord, ProjectStatus } from '@/lib/api/projects/types';
import { fetchVisibleProjects } from '@/lib/api/projects/visible-projects';
import { createBrowserClient } from '@/lib/supabase/client';
import type { ApiError } from '@/types/api-error';

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: () => [...projectKeys.lists(), 'all'] as const,
  userList: () => [...projectKeys.lists(), 'user'] as const,
  memberList: () => [...projectKeys.lists(), 'member'] as const,
  recordList: () => [...projectKeys.lists(), 'records'] as const
};

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, archived: 1 };

// admins see every project. everyone else sends the same predicate rls already
// enforces (responsible or assigned), so postgres does not scan the whole table.
export async function getProjects(): Promise<Project[]> {
  const supabase = createBrowserClient();
  const viewer = await getSessionViewer(supabase);

  if (!viewer) {
    return [];
  }

  if (viewer.role === 'admin') {
    const { data, error, status } = await supabase.from('projects').select(PROJECT_COLUMNS);

    if (error) {
      throw {
        message: error.message,
        statusCode: status
      } satisfies ApiError;
    }

    return mapProjectsRowsToProjects(data ?? []);
  }

  return fetchVisibleProjects(supabase, viewer.id);
}

export async function getUserProjects(): Promise<Project[]> {
  const supabase = createBrowserClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw {
      message: userError.message,
      statusCode: userError.status ?? 401
    } satisfies ApiError;
  }

  if (!userData.user) {
    return [];
  }

  const { data, error, status } = await supabase.from('projects').select(PROJECT_COLUMNS).eq('manager_id', userData.user.id);

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapProjectsRowsToProjects(data);
}

// a user belongs to a project when they manage it or hold a rate on it
export async function getMyProjects(): Promise<MemberProject[]> {
  const supabase = createBrowserClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw {
      message: userError.message,
      statusCode: userError.status ?? 401
    } satisfies ApiError;
  }

  if (!userData.user) {
    return [];
  }

  const projects = await fetchVisibleProjects(supabase, userData.user.id);

  return toMemberProjects(projects, userData.user.id);
}

export function toMemberProjects(projects: Project[], userId: string): MemberProject[] {
  return projects
    .map((project) => ({ project, membership: project.managerId === userId ? ('manager' as const) : ('member' as const) }))
    .sort((a, b) => STATUS_ORDER[a.project.status] - STATUS_ORDER[b.project.status] || a.project.name.localeCompare(b.project.name));
}

// membership pairs without rates, so staff also see who else works on their projects
export async function getProjectMembers(): Promise<ProjectMember[]> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase.rpc('get_project_members');

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapProjectMemberRows(data);
}

export async function getProjectRecords(): Promise<ProjectRecord[]> {
  const [projects, members] = await Promise.all([getProjects(), getProjectMembers()]);

  return toProjectRecords(projects, members);
}

export function useProjectRecords() {
  return useQuery<ProjectRecord[], ApiError>({
    queryKey: projectKeys.recordList(),
    queryFn: getProjectRecords
  });
}

export function useMyProjects() {
  return useQuery<MemberProject[], ApiError>({
    queryKey: projectKeys.memberList(),
    queryFn: getMyProjects
  });
}

export function useProjects(isEnabled = true) {
  return useQuery<Project[], ApiError>({
    queryKey: projectKeys.list(),
    queryFn: getProjects,
    enabled: isEnabled
  });
}

export function useUserProjects() {
  return useQuery<Project[], ApiError>({
    queryKey: projectKeys.userList(),
    queryFn: getUserProjects
  });
}

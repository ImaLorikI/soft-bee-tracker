'use client';

import { useQuery } from '@tanstack/react-query';

import { mapTrackerRowToTracker, mapTrackersRowsToTrackers, TRACKER_COLUMNS } from '@/lib/api/trackers/mappers';
import type { MemberTrackersInput, ProjectTrackersInput, Tracker } from '@/lib/api/trackers/types';
import { createBrowserClient } from '@/lib/supabase/client';
import type { ApiError } from '@/types/api-error';

export const trackerKeys = {
  all: ['trackers'] as const,
  lists: () => [...trackerKeys.all, 'list'] as const,
  list: () => [...trackerKeys.lists()] as const,
  project: (input: ProjectTrackersInput) => [...trackerKeys.all, 'project', input] as const,
  member: (input: MemberTrackersInput) => [...trackerKeys.all, 'member', input] as const,
  activeLive: () => [...trackerKeys.all, 'active-live'] as const
};

// RLS returns every entry to admins, entries on the projects they manage to managers, and only their own to staff
export async function getProjectTrackers({ projectId, from, to }: ProjectTrackersInput): Promise<Tracker[]> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase
    .from('trackers')
    .select(TRACKER_COLUMNS)
    .eq('project_id', projectId)
    .gte('date', from)
    .lte('date', to);

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapTrackersRowsToTrackers(data);
}

export function useProjectTrackers(input: ProjectTrackersInput) {
  return useQuery<Tracker[], ApiError>({
    queryKey: trackerKeys.project(input),
    queryFn: () => getProjectTrackers(input)
  });
}

export async function getTrackers(): Promise<Tracker[]> {
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

  return fetchUserTrackers({ userId: userData.user.id });
}

export function useTrackers() {
  return useQuery({
    queryKey: trackerKeys.list(),
    queryFn: getTrackers
  });
}

export async function getActiveLiveTracker(): Promise<Tracker | null> {
  const supabase = createBrowserClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    throw {
      message: userError.message,
      statusCode: userError.status ?? 401
    } satisfies ApiError;
  }

  if (!userData.user) {
    return null;
  }

  const { data, error, status } = await supabase
    .from('trackers')
    .select(TRACKER_COLUMNS)
    .eq('user_id', userData.user.id)
    .eq('is_live', true)
    .in('live_status', ['start', 'pause'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return data ? mapTrackerRowToTracker(data) : null;
}

export function useActiveLiveTracker() {
  return useQuery({
    queryKey: trackerKeys.activeLive(),
    queryFn: getActiveLiveTracker
  });
}

// one person's entries for review. rls limits managers to the projects they manage, so a
// manager may see only part of a member's time
export function getMemberTrackers({ userId, from, to }: MemberTrackersInput): Promise<Tracker[]> {
  return fetchUserTrackers({ userId, range: { from, to } });
}

export function useMemberTrackers(input: MemberTrackersInput) {
  return useQuery<Tracker[], ApiError>({
    queryKey: trackerKeys.member(input),
    queryFn: () => getMemberTrackers(input)
  });
}

// newest day first, then in the order they were logged
async function fetchUserTrackers({ userId, range }: FetchUserTrackersInput): Promise<Tracker[]> {
  const supabase = createBrowserClient();
  let query = supabase.from('trackers').select(TRACKER_COLUMNS).eq('user_id', userId);

  if (range) {
    query = query.gte('date', range.from).lte('date', range.to);
  }

  const { data, error, status } = await query.order('date', { ascending: false }).order('created_at', { ascending: true });

  if (error) {
    throw {
      message: error.message,
      statusCode: status
    } satisfies ApiError;
  }

  return mapTrackersRowsToTrackers(data);
}

interface FetchUserTrackersInput {
  userId: string;
  range?: { from: string; to: string };
}

'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';

import { format } from 'date-fns';

import { crewKeys } from '@/lib/api/crew/queries';
import {
  mapCreateTrackerInputToRow,
  mapStartLiveTrackerInputToRow,
  mapTrackerReviewErrorToApiError,
  mapTrackerWriteErrorToApiError,
  mapTrackerRowToTracker,
  TRACKER_COLUMNS,
  type UpdateTrackerRow
} from '@/lib/api/trackers/mappers';
import { trackerKeys } from '@/lib/api/trackers/queries';
import type {
  CreateTrackerInput,
  FinishLiveTrackerInput,
  StartLiveTrackerInput,
  Tracker,
  TrackerReviewNoteInput,
  UpdateTrackerInput
} from '@/lib/api/trackers/types';
import { getLiveElapsedMinutes, getLiveWholeMinutes } from '@/lib/live-tracker';
import { createBrowserClient } from '@/lib/supabase/client';
import type { ApiError } from '@/types/api-error';
import content from './content.json';

interface UseTrackerMutationOptions {
  onSuccess?: (tracker: Tracker) => void;
}

interface TrackerMutationConfig<TInput> {
  mutationFn: (input: TInput) => Promise<Tracker>;
  successMessage: string;
  options?: UseTrackerMutationOptions;
  extraInvalidateKeys?: QueryKey[];
}

export async function createTracker(input: CreateTrackerInput): Promise<Tracker> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase
    .from('trackers')
    .insert(mapCreateTrackerInputToRow(input))
    .select(TRACKER_COLUMNS)
    .single();

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return mapTrackerRowToTracker(data);
}

export function useCreateTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({ mutationFn: createTracker, successMessage: content.created, options });
}

export async function startLiveTracker(input: StartLiveTrackerInput): Promise<Tracker> {
  const supabase = createBrowserClient();
  const startedAt = new Date();
  const { data, error, status } = await supabase
    .from('trackers')
    .insert(mapStartLiveTrackerInputToRow(input, startedAt, format(startedAt, 'yyyy-MM-dd')))
    .select(TRACKER_COLUMNS)
    .single();

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return mapTrackerRowToTracker(data);
}

export function pauseLiveTracker(tracker: Tracker): Promise<Tracker> {
  return updateLiveTracker(tracker.id, {
    live_status: 'pause',
    live_duration_minutes: getLiveWholeMinutes(tracker, new Date()),
    start_live_date: null
  });
}

export function resumeLiveTracker(tracker: Tracker): Promise<Tracker> {
  return updateLiveTracker(tracker.id, {
    live_status: 'start',
    start_live_date: new Date().toISOString()
  });
}

export function finishLiveTracker({ tracker, entry }: FinishLiveTrackerInput): Promise<Tracker> {
  return updateLiveTracker(tracker.id, {
    live_status: 'finish',
    live_duration_minutes: getLiveElapsedMinutes(tracker, new Date()),
    start_live_date: null,
    project_id: entry.projectId,
    date: entry.date,
    description: entry.description,
    duration_minutes: entry.durationMinutes
  });
}

export async function discardLiveTracker(tracker: Tracker): Promise<Tracker> {
  if (tracker.durationMinutes > 0) {
    return updateLiveTracker(tracker.id, {
      live_status: 'finish',
      live_duration_minutes: tracker.durationMinutes,
      start_live_date: null
    });
  }

  const supabase = createBrowserClient();
  const { error, status } = await supabase.from('trackers').delete().eq('id', tracker.id).in('live_status', ['start', 'pause']);

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return tracker;
}

export async function restartLiveTracker(tracker: Tracker): Promise<Tracker> {
  return updateTrackerRow(tracker.id, {
    is_live: true,
    live_status: 'start',
    live_duration_minutes: tracker.durationMinutes,
    start_live_date: new Date().toISOString()
  });
}

export function updateTracker({ trackerId, entry }: UpdateTrackerInput): Promise<Tracker> {
  return updateTrackerRow(trackerId, mapCreateTrackerInputToRow(entry));
}

export async function deleteTracker(tracker: Tracker): Promise<Tracker> {
  const supabase = createBrowserClient();
  const { error, status } = await supabase.from('trackers').delete().eq('id', tracker.id);

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return tracker;
}

// no status filter: the review trigger rejects an invalid move (e.g. an entry another reviewer
// already decided) with its own key, so "no row returned" only means the viewer has no access
export function approveTracker(trackerId: string): Promise<Tracker> {
  return updateTrackerReview(trackerId, { status: 'approved' });
}

export function rejectTracker({ trackerId, note }: TrackerReviewNoteInput): Promise<Tracker> {
  return updateTrackerReview(trackerId, { status: 'rejected', review_note: note.trim() });
}

// the reason is not kept on the entry: the trigger moves it into tracker_reviews
export function undoTrackerReview({ trackerId, note }: TrackerReviewNoteInput): Promise<Tracker> {
  return updateTrackerReview(trackerId, { status: 'new', review_note: note.trim() });
}

async function updateTrackerReview(trackerId: string, changes: UpdateTrackerRow): Promise<Tracker> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase.from('trackers').update(changes).eq('id', trackerId).select(TRACKER_COLUMNS).single();

  if (error) {
    throw mapTrackerReviewErrorToApiError(error, status);
  }

  return mapTrackerRowToTracker(data);
}

async function updateTrackerRow(trackerId: string, changes: UpdateTrackerRow): Promise<Tracker> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase.from('trackers').update(changes).eq('id', trackerId).select(TRACKER_COLUMNS).single();

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return mapTrackerRowToTracker(data);
}

async function updateLiveTracker(trackerId: string, changes: UpdateTrackerRow): Promise<Tracker> {
  const supabase = createBrowserClient();
  const { data, error, status } = await supabase
    .from('trackers')
    .update(changes)
    .eq('id', trackerId)
    .in('live_status', ['start', 'pause'])
    .select(TRACKER_COLUMNS)
    .single();

  if (error) {
    throw mapTrackerWriteErrorToApiError(error, status);
  }

  return mapTrackerRowToTracker(data);
}

export function useStartLiveTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({ mutationFn: startLiveTracker, successMessage: content.timerStarted, options });
}

export function usePauseLiveTracker() {
  return useTrackerMutation({ mutationFn: pauseLiveTracker, successMessage: content.timerPaused });
}

export function useResumeLiveTracker() {
  return useTrackerMutation({ mutationFn: resumeLiveTracker, successMessage: content.timerResumed });
}

export function useFinishLiveTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({ mutationFn: finishLiveTracker, successMessage: content.entrySaved, options });
}

export function useRestartLiveTracker() {
  return useTrackerMutation({ mutationFn: restartLiveTracker, successMessage: content.timerResumed });
}

export function useUpdateTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({ mutationFn: updateTracker, successMessage: content.entryUpdated, options });
}

export function useDeleteTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({ mutationFn: deleteTracker, successMessage: content.entryDeleted, options });
}

export function useDiscardLiveTracker() {
  return useTrackerMutation({ mutationFn: discardLiveTracker, successMessage: content.timerDiscarded });
}

// approving does not change any crew totals (only rejected time is left out), so the crew
// snapshot stays cached; reject and undo do change them
export function useApproveTracker() {
  return useTrackerMutation({ mutationFn: approveTracker, successMessage: content.entryApproved });
}

export function useRejectTracker(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({
    mutationFn: rejectTracker,
    successMessage: content.entryRejected,
    options,
    extraInvalidateKeys: REVIEW_INVALIDATE_KEYS
  });
}

export function useUndoTrackerReview(options?: UseTrackerMutationOptions) {
  return useTrackerMutation({
    mutationFn: undoTrackerReview,
    successMessage: content.reviewUndone,
    options,
    extraInvalidateKeys: REVIEW_INVALIDATE_KEYS
  });
}

// reject and undo change the crew snapshot: its time totals leave rejected entries out
const REVIEW_INVALIDATE_KEYS: QueryKey[] = [crewKeys.all];

function useTrackerMutation<TInput>({ mutationFn, successMessage, options, extraInvalidateKeys = [] }: TrackerMutationConfig<TInput>) {
  const queryClient = useQueryClient();

  return useMutation<Tracker, ApiError, TInput>({
    mutationFn,
    onSuccess: (tracker) => {
      toast.success(successMessage);
      options?.onSuccess?.(tracker);
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      for (const queryKey of [trackerKeys.all, ...extraInvalidateKeys]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  });
}

import type { CreateTrackerInput, StartLiveTrackerInput, Tracker } from '@/lib/api/trackers/types';
import type { Database } from '@/types';
import type { ApiError } from '@/types/api-error';
import content from './content.json';

type TrackerRow = Database['public']['Tables']['trackers']['Row'];
type InputTrackerRow = Database['public']['Tables']['trackers']['Insert'];
export type UpdateTrackerRow = Database['public']['Tables']['trackers']['Update'];

export const TRACKER_COLUMNS =
  'id, created_at, updated_at, date, description, duration_minutes, is_live, live_duration_minutes, live_status, status, start_live_date, project_id, user_id, transaction_id, reviewed_by, reviewed_at, review_note';

export function mapTrackerRowToTracker(row: TrackerRow): Tracker {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.date,
    description: row.description,
    durationMinutes: row.duration_minutes,
    isLive: row.is_live,
    liveDurationMinutes: row.live_duration_minutes,
    liveStatus: row.live_status,
    status: row.status,
    startLiveDate: row.start_live_date,
    projectId: row.project_id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note
  };
}

export function mapTrackersRowsToTrackers(rows: TrackerRow[]): Tracker[] {
  return rows.map(mapTrackerRowToTracker);
}

export function mapCreateTrackerInputToRow(input: CreateTrackerInput): InputTrackerRow {
  return {
    date: input.date,
    description: input.description,
    duration_minutes: input.durationMinutes,
    project_id: input.projectId
  };
}

export function mapStartLiveTrackerInputToRow(input: StartLiveTrackerInput, startedAt: Date, date: string): InputTrackerRow {
  return {
    date,
    description: input.description,
    duration_minutes: 0,
    project_id: input.projectId,
    is_live: true,
    live_status: 'start',
    live_duration_minutes: 0,
    start_live_date: startedAt.toISOString()
  };
}

// codes and messages come from private.guard_tracker_review and the trackers rls policies
export function mapTrackerReviewErrorToApiError(error: TrackerDatabaseError, statusCode: number): ApiError {
  return {
    message: getTrackerReviewErrorMessage(error),
    statusCode
  };
}

function getTrackerReviewErrorMessage(error: TrackerDatabaseError): string {
  switch (error.code) {
    case '42501':
      if (error.message.includes('your own')) {
        return content.reviewErrors.ownEntry;
      }

      return error.message.includes('Only an admin') ? content.reviewErrors.adminEntry : content.reviewErrors.notAllowed;
    case '23514':
      if (error.message.includes('reason')) {
        return content.reviewErrors.reasonRequired;
      }

      return error.message.includes('running timer') ? content.reviewErrors.timerRunning : content.reviewErrors.staleEntry;
    case NO_ROWS_ERROR_CODE:
      return content.reviewErrors.staleEntry;
    default:
      return content.reviewErrors.unexpected;
  }
}

const NO_ROWS_ERROR_CODE = 'PGRST116';

export interface TrackerDatabaseError {
  code: string;
  message: string;
}

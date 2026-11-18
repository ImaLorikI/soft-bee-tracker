import { format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  approveTracker,
  discardLiveTracker,
  finishLiveTracker,
  pauseLiveTracker,
  rejectTracker,
  restartLiveTracker,
  resumeLiveTracker,
  startLiveTracker,
  undoTrackerReview
} from './mutations';
import type { Tracker, TrackerStatus } from './types';

const createBrowserClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createBrowserClient }));

const NOW = new Date('2026-11-05T12:00:00.000Z');

const trackerRow = {
  id: 'tracker-1',
  created_at: '2026-11-05T11:00:00.000Z',
  updated_at: '2026-11-05T11:00:00.000Z',
  date: '2026-11-05',
  description: 'Work',
  duration_minutes: 0,
  is_live: true,
  live_duration_minutes: 0,
  live_status: 'start' as const,
  status: 'new' as TrackerStatus,
  start_live_date: '2026-11-05T11:00:00.000Z',
  project_id: 'project-1',
  user_id: 'user-1',
  transaction_id: null,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null
};

const runningTracker: Tracker = {
  id: 'tracker-1',
  createdAt: '2026-11-05T11:00:00.000Z',
  updatedAt: '2026-11-05T11:00:00.000Z',
  date: '2026-11-05',
  description: 'Work',
  durationMinutes: 0,
  isLive: true,
  liveDurationMinutes: 10,
  liveStatus: 'start',
  status: 'new',
  startLiveDate: '2026-11-05T11:58:30.000Z',
  projectId: 'project-1',
  userId: 'user-1',
  transactionId: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null
};

interface QueryResult {
  data: typeof trackerRow | null;
  error: { message: string; code?: string; hint?: string } | null;
  status: number;
}

function mockTrackersTable(result: QueryResult = { data: trackerRow, error: null, status: 200 }) {
  const builder = {
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  };
  const from = vi.fn(() => builder);
  createBrowserClient.mockReturnValue({ from });

  return { builder, from };
}

describe('live tracker mutations', () => {
  beforeEach(() => {
    createBrowserClient.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a live tracker dated today with no banked time', async () => {
    const { builder, from } = mockTrackersTable();

    const tracker = await startLiveTracker({ projectId: 'project-1', description: 'Work' });

    expect(from).toHaveBeenCalledWith('trackers');
    expect(builder.insert).toHaveBeenCalledWith({
      date: format(NOW, 'yyyy-MM-dd'),
      description: 'Work',
      duration_minutes: 0,
      project_id: 'project-1',
      is_live: true,
      live_status: 'start',
      live_duration_minutes: 0,
      start_live_date: NOW.toISOString()
    });
    expect(tracker.id).toBe('tracker-1');
  });

  it('banks floored minutes on pause and only touches an active timer', async () => {
    const { builder } = mockTrackersTable();

    await pauseLiveTracker(runningTracker);

    expect(builder.update).toHaveBeenCalledWith({ live_status: 'pause', live_duration_minutes: 11, start_live_date: null });
    expect(builder.eq).toHaveBeenCalledWith('id', 'tracker-1');
    expect(builder.in).toHaveBeenCalledWith('live_status', ['start', 'pause']);
  });

  it('does not credit a sub-minute run on pause', async () => {
    const { builder } = mockTrackersTable();

    await pauseLiveTracker({ ...runningTracker, liveDurationMinutes: 5, startLiveDate: '2026-11-05T11:59:31.000Z' });

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ live_duration_minutes: 5 }));
  });

  it('resumes from now without changing banked minutes', async () => {
    const { builder } = mockTrackersTable();

    await resumeLiveTracker({ ...runningTracker, liveStatus: 'pause', startLiveDate: null });

    expect(builder.update).toHaveBeenCalledWith({ live_status: 'start', start_live_date: NOW.toISOString() });
    expect(builder.in).toHaveBeenCalledWith('live_status', ['start', 'pause']);
  });

  it('finishes with the entry the user confirmed', async () => {
    const { builder } = mockTrackersTable();

    await finishLiveTracker({
      tracker: runningTracker,
      entry: { projectId: 'project-2', date: '2026-11-04', description: null, durationMinutes: 45 }
    });

    expect(builder.update).toHaveBeenCalledWith({
      live_status: 'finish',
      live_duration_minutes: 12,
      start_live_date: null,
      project_id: 'project-2',
      date: '2026-11-04',
      description: null,
      duration_minutes: 45
    });
    expect(builder.in).toHaveBeenCalledWith('live_status', ['start', 'pause']);
  });

  it('deletes a brand-new timer on discard', async () => {
    const { builder } = mockTrackersTable({ data: null, error: null, status: 204 });

    const result = await discardLiveTracker(runningTracker);

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'tracker-1');
    expect(builder.in).toHaveBeenCalledWith('live_status', ['start', 'pause']);
    expect(result).toBe(runningTracker);
  });

  it('restores the saved duration when discarding a continued entry', async () => {
    const { builder } = mockTrackersTable();

    await discardLiveTracker({ ...runningTracker, durationMinutes: 30, liveDurationMinutes: 30 });

    expect(builder.delete).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ live_status: 'finish', live_duration_minutes: 30, start_live_date: null });
  });

  it('continues a saved entry from its existing duration', async () => {
    const { builder } = mockTrackersTable();

    await restartLiveTracker({ ...runningTracker, isLive: false, liveStatus: null, durationMinutes: 40, startLiveDate: null });

    expect(builder.update).toHaveBeenCalledWith({
      is_live: true,
      live_status: 'start',
      live_duration_minutes: 40,
      start_live_date: NOW.toISOString()
    });
    expect(builder.in).not.toHaveBeenCalled();
  });

  it('normalizes a failed update to an ApiError with the response status', async () => {
    mockTrackersTable({ data: null, error: { message: 'Permission denied' }, status: 403 });

    await expect(pauseLiveTracker(runningTracker)).rejects.toEqual({ message: 'Permission denied', statusCode: 403 });
  });

  it('normalizes a failed discard to an ApiError with the response status', async () => {
    mockTrackersTable({ data: null, error: { message: 'Permission denied' }, status: 403 });

    await expect(discardLiveTracker(runningTracker)).rejects.toEqual({ message: 'Permission denied', statusCode: 403 });
  });
});

describe('tracker review mutations', () => {
  beforeEach(() => {
    createBrowserClient.mockReset();
  });

  it('approves an entry and leaves status rules to the database', async () => {
    const { builder, from } = mockTrackersTable({ data: { ...trackerRow, status: 'approved' }, error: null, status: 200 });

    const tracker = await approveTracker('tracker-1');

    expect(from).toHaveBeenCalledWith('trackers');
    expect(builder.update).toHaveBeenCalledWith({ status: 'approved' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'tracker-1');
    expect(builder.in).not.toHaveBeenCalled();
    expect(tracker.status).toBe('approved');
  });

  it('rejects an entry with a trimmed reason', async () => {
    const { builder } = mockTrackersTable();

    await rejectTracker({ trackerId: 'tracker-1', note: '  Wrong project  ' });

    expect(builder.update).toHaveBeenCalledWith({ status: 'rejected', review_note: 'Wrong project' });
  });

  it('undoes a review with a trimmed reason', async () => {
    const { builder } = mockTrackersTable();

    await undoTrackerReview({ trackerId: 'tracker-1', note: '  Approved the wrong day ' });

    expect(builder.update).toHaveBeenCalledWith({ status: 'new', review_note: 'Approved the wrong day' });
  });

  it.each([
    ['tracker_review.not_reviewer', 403, "You can't review this entry. It may be on a project you don't manage."],
    ['tracker_review.own_entry', 403, "You can't review your own time entries."],
    ['tracker_review.admin_entry', 403, 'Only an admin can review this entry.'],
    ['tracker_review.reason_required', 400, 'Add a reason to reject this entry.'],
    ['tracker_review.undo_reason_required', 400, 'Add a reason to undo this review.'],
    ['tracker_review.reason_too_long', 400, 'The reason can be at most 500 characters.'],
    ['tracker_review.timer_running', 400, "This timer is still running and can't be reviewed yet."],
    ['tracker_review.invalid_transition', 400, 'This entry was already reviewed. Refresh to see the latest decision.'],
    ['tracker_review.reviewed_locked', 400, 'Undo the review before changing this entry.']
  ])('maps the %s key to its message', async (hint, status, message) => {
    // the message text is deliberately unrelated: only the hint key may drive the mapping
    mockTrackersTable({
      data: null,
      error: { code: status === 403 ? '42501' : '23514', message: 'reworded in the database', hint },
      status
    });

    await expect(approveTracker('tracker-1')).rejects.toEqual({ message, statusCode: status });
  });

  it("reports no access when rls returns no row (another manager's project)", async () => {
    mockTrackersTable({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      status: 406
    });

    await expect(approveTracker('tracker-1')).rejects.toEqual({
      message: "You can't review this entry. It may be on a project you don't manage.",
      statusCode: 406
    });
  });

  it('does not leak raw database messages for unknown errors', async () => {
    mockTrackersTable({ data: null, error: { code: 'XX000', message: 'internal detail' }, status: 500 });

    await expect(approveTracker('tracker-1')).rejects.toEqual({ message: "Couldn't update the review. Try again.", statusCode: 500 });
  });
});

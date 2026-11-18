import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrackerReviews } from './queries';

const createBrowserClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createBrowserClient }));

interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
  status: number;
}

function mockReviewsTable(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result))
  };
  const from = vi.fn(() => builder);
  createBrowserClient.mockReturnValue({ from });

  return { builder, from };
}

describe('getTrackerReviews', () => {
  beforeEach(() => {
    createBrowserClient.mockReset();
  });

  it('skips the request when there are no entries', async () => {
    await expect(getTrackerReviews([])).resolves.toEqual([]);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('loads the history of the given entries, newest first', async () => {
    const { builder, from } = mockReviewsTable({
      data: [
        {
          id: 'review-1',
          created_at: '2026-11-18T10:00:00.000Z',
          tracker_id: 'tracker-1',
          action: 'undone',
          actor_id: 'manager-1',
          note: 'Approved the wrong day',
          previous_status: 'approved'
        }
      ],
      error: null,
      status: 200
    });

    const reviews = await getTrackerReviews(['tracker-1', 'tracker-2']);

    expect(from).toHaveBeenCalledWith('tracker_reviews');
    expect(builder.in).toHaveBeenCalledWith('tracker_id', ['tracker-1', 'tracker-2']);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(reviews).toEqual([
      {
        id: 'review-1',
        createdAt: '2026-11-18T10:00:00.000Z',
        trackerId: 'tracker-1',
        action: 'undone',
        actorId: 'manager-1',
        note: 'Approved the wrong day',
        previousStatus: 'approved'
      }
    ]);
  });

  it('normalizes a failed request to an ApiError', async () => {
    mockReviewsTable({ data: null, error: { message: 'Permission denied' }, status: 403 });

    await expect(getTrackerReviews(['tracker-1'])).rejects.toEqual({ message: 'Permission denied', statusCode: 403 });
  });
});

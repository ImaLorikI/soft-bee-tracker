import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSignedInUserId } from './queries';

const createBrowserClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createBrowserClient }));

describe('getSignedInUserId', () => {
  let getSession: ReturnType<typeof vi.fn>;
  let getUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getSession = vi.fn();
    getUser = vi.fn();
    createBrowserClient.mockReset();
    createBrowserClient.mockReturnValue({ auth: { getSession, getUser } });
  });

  it('returns the user id from the local session', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });

    await expect(getSignedInUserId()).resolves.toBe('user-1');
  });

  // the point of the helper: no /auth/v1/user round-trip per query
  it('does not ask the Auth server for the user', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });

    await getSignedInUserId();

    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns null when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getSignedInUserId()).resolves.toBeNull();
  });

  it('throws an ApiError with the auth error status', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token', status: 400 } });

    await expect(getSignedInUserId()).rejects.toEqual({ message: 'Invalid Refresh Token', statusCode: 400 });
  });

  it('falls back to 401 when the auth error has no status', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Auth session missing!' } });

    await expect(getSignedInUserId()).rejects.toEqual({ message: 'Auth session missing!', statusCode: 401 });
  });
});

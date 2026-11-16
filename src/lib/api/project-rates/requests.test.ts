import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectRate } from './mutations';
import { getProjectRates } from './queries';
import type { CreateProjectRateInput } from './types';

const createBrowserClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({ createBrowserClient }));

const rateInput: CreateProjectRateInput = {
  projectId: 'project-1',
  userId: 'user-1',
  rate: 42.5
};

describe('project rates requests', () => {
  beforeEach(() => {
    createBrowserClient.mockReset();
  });

  it('preserves the Supabase response status when loading fails', async () => {
    createBrowserClient.mockReturnValue({
      auth: { getClaims: claimsFor('user-1', 'admin') },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Forbidden' },
          status: 403
        })
      })
    });

    await expect(getProjectRates()).rejects.toEqual({
      message: 'Forbidden',
      statusCode: 403
    });
  });

  it.each(['worker', null])('loads only the signed-in user rates when the role is %s', async (role) => {
    const eq = vi.fn().mockResolvedValue({ data: [rateRow], error: null, status: 200 });
    createBrowserClient.mockReturnValue({
      auth: { getClaims: claimsFor('user-1', role) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq })
      })
    });

    const rates = await getProjectRates();

    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rates).toEqual([
      {
        projectId: 'project-1',
        userId: 'user-1',
        rate: 42.5,
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-20T10:00:00.000Z'
      }
    ]);
  });

  it('loads a manager rates for the projects they can see', async () => {
    const rateIds = vi.fn().mockResolvedValue({ data: [{ project_id: 'project-1' }], error: null, status: 200 });
    const projectIds = vi.fn().mockResolvedValue({ data: [{ id: 'project-1' }, { id: 'project-2' }], error: null, status: 200 });
    const ratesIn = vi.fn().mockResolvedValue({ data: [rateRow], error: null, status: 200 });
    const from = vi.fn((table: string) => {
      if (table === 'projects') {
        return { select: vi.fn().mockReturnValue({ or: projectIds }) };
      }

      return {
        select: (columns: string) => (columns === 'project_id' ? { eq: rateIds } : { in: ratesIn })
      };
    });
    createBrowserClient.mockReturnValue({
      auth: { getClaims: claimsFor('user-1', 'manager') },
      from
    });

    await getProjectRates();

    expect(rateIds).toHaveBeenCalledWith('user_id', 'user-1');
    expect(projectIds).toHaveBeenCalledWith('manager_id.eq.user-1,id.in.(project-1)');
    expect(ratesIn).toHaveBeenCalledWith('project_id', ['project-1', 'project-2']);
  });

  it('preserves the Supabase response status when creation fails', async () => {
    createBrowserClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Rate already exists' },
              status: 409
            })
          })
        })
      })
    });

    await expect(createProjectRate(rateInput)).rejects.toEqual({
      message: 'Rate already exists',
      statusCode: 409
    });
  });
});

function claimsFor(userId: string, role: string | null) {
  return vi.fn().mockResolvedValue({
    data: { claims: { sub: userId, user_role: role } },
    error: null
  });
}

const rateRow = {
  project_id: 'project-1',
  user_id: 'user-1',
  rate: 42.5,
  created_at: '2026-08-20T10:00:00.000Z',
  updated_at: '2026-08-20T10:00:00.000Z'
};

import { describe, expect, it } from 'vitest';

import { rejectTrackerFormSchema } from './reject-tracker-form.schema';

describe('rejectTrackerFormSchema', () => {
  it('accepts a reason and trims it', () => {
    expect(rejectTrackerFormSchema.parse({ note: '  Wrong project  ' })).toEqual({ note: 'Wrong project' });
  });

  it('requires a reason that is not blank', () => {
    expect(rejectTrackerFormSchema.safeParse({ note: '   ' }).success).toBe(false);
  });

  it('caps the reason at 500 characters', () => {
    expect(rejectTrackerFormSchema.safeParse({ note: 'a'.repeat(500) }).success).toBe(true);
    expect(rejectTrackerFormSchema.safeParse({ note: 'a'.repeat(501) }).success).toBe(false);
  });
});

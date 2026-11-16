import type { SupabaseClient } from '@supabase/supabase-js';

import type { UserRole } from '@/lib/api/auth/types';
import { parseUserRole } from '@/lib/route-access';
import type { Database } from '@/types';
import type { ApiError } from '@/types/api-error';

export interface SessionViewer {
  id: string;
  role: UserRole | null;
}

// role comes from the verified user_role claim, the same value rls reads.
// a missing claim fails closed (role null): callers must not treat that as admin.
export async function getSessionViewer(supabase: SupabaseClient<Database>): Promise<SessionViewer | null> {
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    throw {
      message: error.message,
      statusCode: error.status
    } satisfies ApiError;
  }

  if (!data?.claims.sub) {
    return null;
  }

  return {
    id: data.claims.sub,
    role: parseUserRole(typeof data.claims.user_role === 'string' ? data.claims.user_role : null)
  };
}

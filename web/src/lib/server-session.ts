import { cookies } from 'next/headers';

import { adminSupabase } from '@/lib/admin-supabase';
import { validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';

export type ServerSessionRole = 'admin' | 'manager' | 'fc';

export type VerifiedServerSession = {
  role: ServerSessionRole;
  residentId: string;
  residentDigits: string;
};

type SessionCheckOptions = {
  allowedRoles: ServerSessionRole[];
  requireActive?: boolean;
};

type SessionCheckResult =
  | { ok: true; session: VerifiedServerSession }
  | { ok: false; status: number; error: string };

const normalizeDigits = (value: string) => value.replace(/[^0-9]/g, '');

async function verifyRecord(role: ServerSessionRole, residentDigits: string, requireActive: boolean) {
  if (role === 'admin') {
    let query = adminSupabase
      .from('admin_accounts')
      .select('id,active')
      .eq('phone', residentDigits);

    if (requireActive) {
      query = query.eq('active', true);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }

  if (role === 'manager') {
    let query = adminSupabase
      .from('manager_accounts')
      .select('id,active')
      .eq('phone', residentDigits);

    if (requireActive) {
      query = query.eq('active', true);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }

  const { data, error } = await adminSupabase
    .from('fc_profiles')
    .select('id')
    .eq('phone', residentDigits)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export async function getVerifiedServerSession(options: SessionCheckOptions): Promise<SessionCheckResult> {
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return { ok: false, status: 401, error: sessionCheck.error ?? 'Unauthorized' };
  }

  if (
    session.role !== 'admin'
    && session.role !== 'manager'
    && session.role !== 'fc'
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (!options.allowedRoles.includes(session.role)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const residentDigits = normalizeDigits(session.residentId);
  if (residentDigits.length !== 11) {
    return { ok: false, status: 401, error: 'Invalid resident phone' };
  }

  try {
    const verified = await verifyRecord(
      session.role,
      residentDigits,
      options.requireActive ?? true,
    );

    if (!verified) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    return {
      ok: true,
      session: {
        role: session.role,
        residentId: session.residentId,
        residentDigits,
      },
    };
  } catch (error: unknown) {
    logger.warn('[server-session] verification failed', {
      role: session.role,
      residentDigits,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }
}


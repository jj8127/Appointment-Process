import { adminSupabase } from '@/lib/admin-supabase';
import { validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Reusing session check logic (should ideally be in a shared lib, but keeping it simple for now)
async function getAdminSession() {
    const cookieStore = await cookies();
    const session = {
        role: cookieStore.get('session_role')?.value ?? null,
        residentId: cookieStore.get('session_resident')?.value ?? '',
    };
    const sessionCheck = validateSession(session);
    if (!sessionCheck.valid) {
        return { ok: false, status: 401, error: sessionCheck.error ?? 'Unauthorized' };
    }
    if (session.role !== 'admin') {
        return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, session };
}

export async function GET() {
    const adminCheck = await getAdminSession();
    if (!adminCheck.ok) {
        return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
    }

    try {
        const { data, error } = await adminSupabase
            .from('fc_profiles')
            .select('*, appointment_date_life_sub, appointment_date_nonlife_sub, fc_documents(doc_type,storage_path,file_name,status,reviewer_note)')
            .order('created_at', { ascending: false });

        if (error) throw error;

        logger.debug('[api/admin/list] fetched count', { count: data?.length });

        return NextResponse.json(data);
    } catch (err: unknown) {
        const error = err as Error;
        logger.error('[api/admin/list] failed', error);
        return NextResponse.json({ error: error?.message ?? 'Fetch failed' }, { status: 500 });
    }
}

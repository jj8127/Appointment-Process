import { adminSupabase } from '@/lib/admin-supabase';
import { validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const DESIGNER_MARKER = '설계매니저';
const AFFILIATION_CANONICAL_OPTIONS = [
    '1본부 서선미',
    '2본부 박성훈',
    '3본부 김태희',
    '4본부 현경숙',
    '5본부 최철준',
    '6본부 김정수(박선희)',
    '7본부 김동훈',
    '8본부 정승철',
    '9본부 이현욱(김주용)',
] as const;
const LEGACY_AFFILIATION_TO_CANONICAL: Record<string, string> = {
    '1본부 [본부장: 서선미]': '1본부 서선미',
    '2본부 [본부장: 박성훈]': '2본부 박성훈',
    '3본부 [본부장: 김태희]': '3본부 김태희',
    '4본부 [본부장: 현경숙]': '4본부 현경숙',
    '5본부 [본부장: 최철준]': '5본부 최철준',
    '6본부 [본부장: 김정수]': '6본부 김정수(박선희)',
    '6본부 [본부장: 박선희]': '6본부 김정수(박선희)',
    '7본부 [본부장: 김동훈]': '7본부 김동훈',
    '8본부 [본부장: 정승철]': '8본부 정승철',
    '9본부 [본부장: 이현욱]': '9본부 이현욱(김주용)',
    '9본부 [본부장: 김주용]': '9본부 이현욱(김주용)',
    '1팀(서울1) : 서선미 본부장님': '1본부 서선미',
    '2팀(서울2) : 박성훈 본부장님': '2본부 박성훈',
    '3팀(부산1) : 김태희 본부장님': '3본부 김태희',
    '4팀(대전1) : 현경숙 본부장님': '4본부 현경숙',
    '5팀(대전2) : 최철준 본부장님': '5본부 최철준',
    '6팀(전주1) : 김정수 본부장님': '6본부 김정수(박선희)',
    '6팀(전주1) : 박선희 본부장님': '6본부 김정수(박선희)',
    '7팀(청주1/직할) : 김동훈 본부장님': '7본부 김동훈',
    '8팀(서울3) : 정승철 본부장님': '8본부 정승철',
    '9팀(서울4) : 이현옥 본부장님': '9본부 이현욱(김주용)',
    '9팀(서울4) : 이현욱 본부장님': '9본부 이현욱(김주용)',
};

const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
const normalizeAffiliationLabel = (value?: string | null): string => {
    const trimmed = normalizeWhitespace(value);
    if (!trimmed) return '';
    if (AFFILIATION_CANONICAL_OPTIONS.includes(trimmed as (typeof AFFILIATION_CANONICAL_OPTIONS)[number])) return trimmed;

    const mapped = LEGACY_AFFILIATION_TO_CANONICAL[trimmed];
    if (mapped) return mapped;

    const prefix = trimmed.match(/^([1-9])\s*(본부|팀)/);
    if (prefix?.[1]) {
        const index = Number(prefix[1]) - 1;
        return AFFILIATION_CANONICAL_OPTIONS[index] ?? trimmed;
    }

    return trimmed;
};

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
            .eq('signup_completed', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const fcOnlyData = (data ?? [])
            .filter((row) => {
                const affiliation = normalizeWhitespace(row?.affiliation);
                return !affiliation.includes(DESIGNER_MARKER);
            })
            .map((row) => ({
                ...row,
                affiliation: normalizeAffiliationLabel(row?.affiliation),
            }));

        logger.debug('[api/admin/list] fetched count', {
            rawCount: data?.length ?? 0,
            fcOnlyCount: fcOnlyData.length,
        });

        return NextResponse.json(fcOnlyData);
    } catch (err: unknown) {
        const error = err as Error;
        logger.error('[api/admin/list] failed', error);
        return NextResponse.json({ error: error?.message ?? 'Fetch failed' }, { status: 500 });
    }
}

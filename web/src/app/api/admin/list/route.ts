import { adminSupabase } from '@/lib/admin-supabase';
import { adminRouteAuthErrorResponse, requireAdminOrManagerReadRoute } from '@/lib/admin-route-auth';
import {
    buildActiveManagerPhoneSet,
    isDashboardFcOnlyRow,
    normalizeDashboardIdentityPhone,
} from '@/lib/dashboard-fc-eligibility';
import { normalizeDashboardFcListRow } from '@/lib/dashboard-table-display';
import { ADMIN_FC_LIST_SELECT, isAdminFcProfile } from '@/lib/admin-document-client';
import { serverError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';
import { NextResponse } from 'next/server';

const AFFILIATION_CANONICAL_OPTIONS = [
    '1본부 서선미',
    '2본부 박성훈',
    '3본부 김태희',
    '4본부 현경숙',
    '5본부 최철준',
    '6본부 김정수(박선희)',
    '7본부 이동훈',
    '8본부 정승철',
    '9본부 이현욱(김주용)',
    '10본부 이수민',
] as const;
const LEGACY_AFFILIATION_TO_CANONICAL: Record<string, string> = {
    '1본부 [본부장: 서선미]': '1본부 서선미',
    '2본부 [본부장: 박성훈]': '2본부 박성훈',
    '3본부 [본부장: 김태희]': '3본부 김태희',
    '4본부 [본부장: 현경숙]': '4본부 현경숙',
    '5본부 [본부장: 최철준]': '5본부 최철준',
    '6본부 [본부장: 김정수]': '6본부 김정수(박선희)',
    '6본부 [본부장: 박선희]': '6본부 김정수(박선희)',
    '7본부 [본부장: 김동훈]': '7본부 이동훈',
    '7본부 [본부장: 이동훈]': '7본부 이동훈',
    '8본부 [본부장: 정승철]': '8본부 정승철',
    '9본부 [본부장: 이현욱]': '9본부 이현욱(김주용)',
    '9본부 [본부장: 김주용]': '9본부 이현욱(김주용)',
    '10본부 [본부장: 한태균]': '10본부 이수민',
    '10본부 [본부장: 이수민]': '10본부 이수민',
    '1팀(서울1) : 서선미 본부장님': '1본부 서선미',
    '2팀(서울2) : 박성훈 본부장님': '2본부 박성훈',
    '3팀(부산1) : 김태희 본부장님': '3본부 김태희',
    '4팀(대전1) : 현경숙 본부장님': '4본부 현경숙',
    '5팀(대전2) : 최철준 본부장님': '5본부 최철준',
    '6팀(전주1) : 김정수 본부장님': '6본부 김정수(박선희)',
    '6팀(전주1) : 박선희 본부장님': '6본부 김정수(박선희)',
    '7팀(청주1/직할) : 김동훈 본부장님': '7본부 이동훈',
    '7팀(청주1/직할) : 이동훈 본부장님': '7본부 이동훈',
    '8팀(서울3) : 정승철 본부장님': '8본부 정승철',
    '9팀(서울4) : 이현옥 본부장님': '9본부 이현욱(김주용)',
    '9팀(서울4) : 이현욱 본부장님': '9본부 이현욱(김주용)',
};

const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();

type ActiveManagerRow = { id: string; phone: string };

const isRecord = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isCredentialRow = (value: unknown): boolean => (
    isRecord(value)
    && (value.password_set_at === null || typeof value.password_set_at === 'string')
);

const isDashboardProfileRow = (value: unknown): value is Record<string, unknown> & {
    id: string;
    phone: string;
    affiliation: string;
} => {
    if (!isAdminFcProfile(value)
        || value.signup_completed !== true
        || !Array.isArray(value.fc_documents)
        || !isRecord(value)) return false;
    const credentialRelation = (value as Record<string, unknown>).fc_credentials;
    return credentialRelation === null
        || isCredentialRow(credentialRelation)
        || (Array.isArray(credentialRelation) && credentialRelation.every(isCredentialRow));
};

const isActiveManagerRow = (value: unknown): value is ActiveManagerRow => (
    isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.phone === 'string'
    && normalizeDashboardIdentityPhone(value.phone).length > 0
);
const normalizeAffiliationLabel = (value?: string | null): string => {
    const trimmed = normalizeWhitespace(value);
    if (!trimmed) return '';
    if (AFFILIATION_CANONICAL_OPTIONS.includes(trimmed as (typeof AFFILIATION_CANONICAL_OPTIONS)[number])) return trimmed;

    const mapped = LEGACY_AFFILIATION_TO_CANONICAL[trimmed];
    if (mapped) return mapped;

    const prefix = trimmed.match(/^(10|[1-9])\s*(본부|팀)/);
    if (prefix?.[1]) {
        const index = Number(prefix[1]) - 1;
        return AFFILIATION_CANONICAL_OPTIONS[index] ?? trimmed;
    }

    return trimmed;
};

export async function GET() {
    const adminCheck = await requireAdminOrManagerReadRoute();
    if (!adminCheck.ok) {
        return adminRouteAuthErrorResponse(adminCheck);
    }

    try {
        const [profileRows, managerRows] = await Promise.all([
            collectSupabaseRows({
                queryName: 'admin_list_profiles',
                isRow: isDashboardProfileRow,
                rowKey: (row) => row.id,
                fetchPage: async (from, to) => adminSupabase
                    .from('fc_profiles')
                    .select(ADMIN_FC_LIST_SELECT)
                    .eq('signup_completed', true)
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .range(from, to),
            }),
            collectSupabaseRows({
                queryName: 'admin_list_managers',
                isRow: isActiveManagerRow,
                rowKey: (row) => row.id,
                fetchPage: async (from, to) => adminSupabase
                    .from('manager_accounts')
                    .select('id,phone')
                    .eq('active', true)
                    .order('phone', { ascending: true })
                    .order('id', { ascending: true })
                    .range(from, to),
            }),
        ]);

        const activeManagerPhones = buildActiveManagerPhoneSet(managerRows);

        const fcOnlyData = profileRows
            .filter((row) => isDashboardFcOnlyRow(row, activeManagerPhones))
            .map((row) => ({
                ...normalizeDashboardFcListRow(row),
                affiliation: normalizeAffiliationLabel(row?.affiliation),
            }));

        logger.debug('[api/admin/list] fetched count', {
            rawCount: profileRows.length,
            fcOnlyCount: fcOnlyData.length,
        });

        return NextResponse.json(fcOnlyData);
    } catch (err: unknown) {
        return serverError(err, 'api/admin/list');
    }
}

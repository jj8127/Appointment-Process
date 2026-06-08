import dayjs from 'dayjs';

export const DASHBOARD_FC_LIST_COLUMNS = [
  { key: 'fc', label: 'FC 정보', width: 200, align: 'left' },
  { key: 'phone', label: '연락처', width: 110, align: 'center' },
  { key: 'signupDate', label: '가입일', width: 120, align: 'center' },
  { key: 'affiliation', label: '소속', width: 150, align: 'center' },
  { key: 'appointmentDate', label: '생명/손해 위촉 완료일', width: 160, align: 'center' },
  { key: 'status', label: '현재 상태', width: 210, align: 'center' },
  { key: 'step', label: '진행 단계', width: 130, align: 'center' },
  { key: 'manage', label: '관리', width: 100, align: 'center' },
] as const;

export const DASHBOARD_FC_LIST_COLUMN_COUNT = DASHBOARD_FC_LIST_COLUMNS.length;

type CredentialRelation =
  | { password_set_at?: unknown }
  | Array<{ password_set_at?: unknown }>
  | null
  | undefined;

export type DashboardFcListRawRow = Record<string, unknown> & {
  created_at?: unknown;
  fc_credentials?: CredentialRelation;
};

const normalizeDateValue = (value: unknown): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
};

const resolveCredentialSignupDate = (relation: CredentialRelation): string | null => {
  if (Array.isArray(relation)) {
    for (const credential of relation) {
      const value = normalizeDateValue(credential?.password_set_at);
      if (value) return value;
    }
    return null;
  }

  return normalizeDateValue(relation?.password_set_at);
};

export const resolveDashboardSignupDate = (row: DashboardFcListRawRow): string | null =>
  resolveCredentialSignupDate(row.fc_credentials) ?? normalizeDateValue(row.created_at);

export function normalizeDashboardFcListRow<T extends DashboardFcListRawRow>(
  row: T,
): Omit<T, 'fc_credentials'> & { signup_completed_at: string | null } {
  const rest = { ...row } as Omit<T, 'fc_credentials'> & { fc_credentials?: CredentialRelation };
  delete rest.fc_credentials;
  return {
    ...rest,
    signup_completed_at: resolveDashboardSignupDate(row),
  };
}

export const formatDashboardSignupDate = (value?: string | null): string => {
  const trimmed = normalizeDateValue(value);
  if (!trimmed) return '-';

  const parsed = dayjs(trimmed);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '-';
};

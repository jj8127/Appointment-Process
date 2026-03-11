export type StaffType = 'admin' | 'developer' | null;
export type WebSessionRole = 'admin' | 'manager' | 'fc' | null;
export type BoardDisplayRole = 'admin' | 'manager' | 'fc' | 'developer';

type SessionLike = {
  role: WebSessionRole;
  staffType?: StaffType;
  isReadOnly?: boolean;
};

export function normalizeStaffType(value: unknown): StaffType {
  return value === 'developer' ? 'developer' : value === 'admin' ? 'admin' : null;
}

export function isDeveloperSession(input: SessionLike) {
  return input.role === 'admin' && !input.isReadOnly && input.staffType === 'developer';
}

export function getDashboardRoleLabel(input: SessionLike) {
  if (input.role === 'manager' || input.isReadOnly) return '본부장';
  if (input.role === 'admin') {
    return input.staffType === 'developer' ? '개발자' : '총무';
  }
  return 'FC';
}

export function getDashboardRoleSubLabel(input: SessionLike) {
  if (input.role === 'manager' || input.isReadOnly) return '본부장 계정';
  if (input.role === 'admin') {
    return input.staffType === 'developer' ? '개발자 계정' : '총무 계정';
  }
  return null;
}

export function getWebStaffChatActorId(input: {
  residentId?: string | null;
  role: WebSessionRole;
  staffType?: StaffType;
}) {
  if (input.role === 'manager' || (input.role === 'admin' && input.staffType === 'developer')) {
    return String(input.residentId ?? '').replace(/[^0-9]/g, '');
  }
  return 'admin';
}

export function getWebStaffSenderName(input: {
  role: WebSessionRole;
  displayName?: string | null;
  residentId?: string | null;
  staffType?: StaffType;
}) {
  if (input.role === 'manager') {
    return input.displayName?.trim() || input.residentId || '본부장';
  }
  if (input.role === 'admin' && input.staffType === 'developer') {
    return input.displayName?.trim() || '개발자';
  }
  return '총무팀';
}

export function getBoardAuthorRoleLabel(role: BoardDisplayRole) {
  if (role === 'developer') return '개발자';
  if (role === 'admin') return '관리자';
  if (role === 'manager') return '본부장';
  return 'FC';
}

export function getBoardAuthorBadgeColor(role: BoardDisplayRole) {
  if (role === 'developer') return 'green';
  if (role === 'admin') return 'blue';
  if (role === 'manager') return 'purple';
  return 'gray';
}

export function getBoardAuthorAvatarColor(role: BoardDisplayRole) {
  if (role === 'developer') return 'green';
  if (role === 'manager') return 'grape';
  if (role === 'admin') return 'blue';
  return 'orange';
}

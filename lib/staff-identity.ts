import { ADMIN_CHAT_ID, sanitizePhone } from '@/lib/messenger-participants';

export type StaffType = 'admin' | 'developer' | null;
export type AppSessionRole = 'admin' | 'fc' | null;
export type BoardDisplayRole = 'admin' | 'manager' | 'fc' | 'developer';

type SessionLike = {
  role: AppSessionRole;
  readOnly?: boolean;
  staffType?: StaffType;
  isRequestBoardDesigner?: boolean;
};

export function normalizeStaffType(value: unknown): StaffType {
  return value === 'developer' ? 'developer' : value === 'admin' ? 'admin' : null;
}

export function isDeveloperSession(input: SessionLike) {
  return input.role === 'admin' && !input.readOnly && input.staffType === 'developer';
}

export function getAccountRoleLabel(input: SessionLike) {
  if (input.isRequestBoardDesigner) return '설계매니저';
  if (input.role === 'admin') {
    if (input.readOnly) return '본부장';
    if (input.staffType === 'developer') return '개발자';
    return '총무';
  }
  return 'FC';
}

export function getAdminStaffAccountTypeLabel(staffType?: StaffType | null) {
  return staffType === 'developer' ? '개발자 계정' : '총무 계정';
}

export function getStaffChatActorId(input: {
  residentId?: string | null;
  readOnly?: boolean;
  staffType?: StaffType;
}) {
  if (input.readOnly || input.staffType === 'developer') {
    return sanitizePhone(input.residentId);
  }
  return ADMIN_CHAT_ID;
}

export function getStaffChatSenderName(input: {
  displayName?: string | null;
  residentId?: string | null;
  readOnly?: boolean;
  staffType?: StaffType;
}) {
  if (input.readOnly) {
    return input.displayName?.trim() || input.residentId || '본부장';
  }
  if (input.staffType === 'developer') {
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

export function getBoardRoleBadgeStyle(role: BoardDisplayRole) {
  if (role === 'developer') {
    return { backgroundColor: '#DCFCE7', color: '#15803D' };
  }
  if (role === 'admin') {
    return { backgroundColor: '#DBEAFE', color: '#2563EB' };
  }
  if (role === 'manager') {
    return { backgroundColor: '#E9D5FF', color: '#9333EA' };
  }
  return { backgroundColor: '#E5E7EB', color: '#6B7280' };
}

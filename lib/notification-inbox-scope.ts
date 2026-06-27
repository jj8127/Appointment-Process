import { sanitizePhone } from './messenger-participants';
import type { StaffType } from './staff-identity';

export type NotificationInboxRole = 'admin' | 'fc' | null;

type NotificationInboxScopeInput = {
  role: NotificationInboxRole;
  residentId?: string | null;
  readOnly?: boolean;
  staffType?: StaffType;
};

export function shouldUsePersonalAdminNotificationInbox(input: NotificationInboxScopeInput) {
  return input.role === 'admin' && (input.readOnly === true || input.staffType === 'developer');
}

export function resolveNotificationInboxResidentId(input: NotificationInboxScopeInput) {
  if (input.role === 'fc' || shouldUsePersonalAdminNotificationInbox(input)) {
    return sanitizePhone(input.residentId) || null;
  }
  return null;
}

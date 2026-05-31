export type ClientSessionRole = 'admin' | 'manager' | 'fc' | null;
export type ClientSessionStaffType = 'admin' | 'developer' | null;

export type ClientSessionSnapshot = {
  role: ClientSessionRole;
  residentId: string;
  residentMask: string;
  displayName: string;
  staffType: ClientSessionStaffType;
};

export function formatSessionResidentMask(raw: string) {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function resolveClientSessionRestore(input: {
  cookieSession: ClientSessionSnapshot | null;
  storageSession: ClientSessionSnapshot | null;
}) {
  return input.cookieSession ?? input.storageSession ?? null;
}

export function isClientSessionReadOnly(role: ClientSessionRole) {
  return role === 'manager';
}

export type AdminWebLoginRole = 'admin' | 'manager' | 'fc';

export function resolveAdminWebLoginRole(value: unknown): AdminWebLoginRole | null {
  return value === 'admin' || value === 'manager' || value === 'fc'
    ? value
    : null;
}

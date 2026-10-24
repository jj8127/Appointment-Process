/**
 * Storage request URLs collapse '.'/'..' segments, also percent-encoded ones, and anon can store
 * any value under its own folder prefix. Only plain object keys reach a service-role Storage call
 * (admin-action and the admin web signDoc route).
 */
export function isPlainFcDocumentPath(storagePath: string): boolean {
  return !/[%\\?#\u0000-\u001f\u007f]/.test(storagePath)
    && storagePath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

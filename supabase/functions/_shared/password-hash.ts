const encoder = new TextEncoder();

export function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

/** Same PBKDF2 parameters as existing FC/admin credentials. */
export async function hashPassword(password: string, saltBase64: string) {
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' }, key, 256,
  );
  return toBase64(new Uint8Array(bits));
}

export async function signupCodeHash(code: string, phone: string) {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${code}:${phone}`))));
}

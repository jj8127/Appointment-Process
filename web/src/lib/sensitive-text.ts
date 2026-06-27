const SECRET_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=\s*[^\s"'`<>]+/gi;

const LONG_HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,}\b/gi;
const SECRET_ASSIGNMENT_DETECT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=/i;
const LONG_HEX_TOKEN_DETECT_PATTERN = /\b[a-f0-9]{32,}\b/i;

export function containsSensitiveText(value: unknown): boolean {
  const text = String(value ?? '');
  return (
    SECRET_ASSIGNMENT_DETECT_PATTERN.test(text) ||
    LONG_HEX_TOKEN_DETECT_PATTERN.test(text)
  );
}

export function redactSensitiveText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;

  const redacted = text
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
      const key = match.split('=')[0]?.trim() || 'SECRET';
      return `${key}=[redacted]`;
    })
    .replace(LONG_HEX_TOKEN_PATTERN, '[redacted]');

  return redacted.trim() || fallback;
}

export function redactSensitiveStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveStrings(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSensitiveStrings(item)]),
    ) as T;
  }
  return value;
}

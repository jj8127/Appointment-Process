const SECRET_KEY_PARTS = [
  'authorization',
  'apikey',
  'api_key',
  'jwt',
  'token',
  'secret',
  'service_role',
  'password',
  'supabase',
];

const NAME_KEY_PARTS = [
  'customername',
  'customer_name',
  'policyholdername',
  'policyholder_name',
  'insuredname',
  'insured_name',
];

const RESIDENT_KEY_PARTS = ['resident', 'ssn'];
const PHONE_KEY_PARTS = ['phone', 'mobile', 'tel'];
const FILE_KEY_PARTS = ['filename', 'file_name', 'filepath', 'file_path', 'attachment', 'storage_path', 'object_key'];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9_]/g, '');

const keyIncludes = (key: string, parts: string[]): boolean => {
  const normalized = normalizeKey(key);
  return parts.some((part) => normalized.includes(part));
};

export const maskResidentNumberString = (value: string): string => {
  const withHyphenMasked = value.replace(
    /(\d{6})[-\s]?([1-8])(\d{6})/g,
    (_matched, front: string, firstBackDigit: string) => `${front}-${firstBackDigit}******`,
  );

  return withHyphenMasked.replace(
    /\b(\d{6})([1-8])(\d{6})\b/g,
    (_matched, front: string, firstBackDigit: string) => `${front}-${firstBackDigit}******`,
  );
};

export const maskPhoneString = (value: string): string => {
  return value.replace(
    /\b(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g,
    (_matched, prefix: string, middle: string, last: string) => `${prefix}-${'*'.repeat(middle.length)}-${last}`,
  );
};

const redactSecretString = (value: string): string => {
  return value
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsb_(?:secret|publishable|anon)_[A-Za-z0-9_-]+\b/g, '[REDACTED]');
};

const redactFileNames = (value: string): string => {
  return value.replace(/[^\s\\/()]+\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|zip)\b/gi, '[REDACTED_FILE]');
};

const sanitizeString = (value: string): string => {
  return redactFileNames(maskPhoneString(maskResidentNumberString(redactSecretString(value))));
};

const sanitizeValueForKey = (key: string, value: unknown, depth: number): unknown => {
  if (keyIncludes(key, SECRET_KEY_PARTS)) return '[REDACTED]';
  if (keyIncludes(key, FILE_KEY_PARTS)) return '[REDACTED_FILE]';
  if (keyIncludes(key, NAME_KEY_PARTS)) return '[REDACTED_NAME]';
  if (keyIncludes(key, RESIDENT_KEY_PARTS) && typeof value === 'string') return maskResidentNumberString(value);
  if (keyIncludes(key, PHONE_KEY_PARTS) && typeof value === 'string') return maskPhoneString(value);
  return sanitizeSentryContext(value, depth);
};

export const sanitizeSentryContext = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '[MaxDepthExceeded]';

  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSentryContext(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        sanitizeValueForKey(key, entryValue, depth + 1),
      ]),
    );
  }

  return value;
};

export const sanitizeSentryEvent = <T>(event: T): T => sanitizeSentryContext(event) as T;

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
const OTP_KEY_PARTS = ['otp', 'otp_code', 'otpcode', 'verification_code', 'verificationcode', 'sms_code', 'smscode'];
const RAW_BODY_KEY_PARTS = [
  'raw_body',
  'rawbody',
  'response_body',
  'responsebody',
  'upstream_body',
  'upstreambody',
  'upstream_response',
  'upstreamresponse',
];

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
  const internationalMasked = value.replace(
    /(^|[^\d])(\+?82)[-.\s]?(?:\(\s*0\s*\)[-.\s]?)?(50[2-8]|70|1[016789]|2|3[1-3]|4[1-4]|5[1-5]|6[1-4])[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?=$|[^\d])/g,
    (_matched, boundary: string, country: string, prefix: string, middle: string, last: string) =>
      `${boundary}${country.startsWith('+') ? '+82' : '82'}-${prefix}-${'*'.repeat(middle.length)}-${last}`,
  );

  return internationalMasked.replace(
    /\b(050[2-8]|070|01[016789]|02|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4]))[-.\s]?(\d{3,4})[-.\s]?(\d{4})\b/g,
    (_matched, prefix: string, middle: string, last: string) => `${prefix}-${'*'.repeat(middle.length)}-${last}`,
  );
};

const redactSecretString = (value: string): string => {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsb_(?:secret|publishable|anon)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(?:Exponent|Expo)PushToken\[[^\]\r\n]+\]/g, '[REDACTED_PUSH_TOKEN]');
};

const redactOtpString = (value: string): string => {
  return value.replace(
    /((?:\b(?:otp|one[-\s]?time(?:\s+password)?|verification\s+code|sms\s+code)\b(?:은|는|이|가)?|인증\s*(?:번호|코드)(?:은|는|이|가)?)\s*[:=#-]?\s*)\d{4,8}\b/gi,
    '$1[REDACTED_OTP]',
  );
};

const redactFileAndStoragePaths = (value: string): string => {
  return value
    .replace(/https?:\/\/[^\s"'()]+\/storage\/v1\/object\/[^\s"'()]+/gi, '[REDACTED_STORAGE_PATH]')
    .replace(
      /((?:storage[\s_-]*(?:path|key)|object[\s_-]*key|저장\s*경로)\s*[:=]\s*)[^\s,;)\]}]+/gi,
      '$1[REDACTED_STORAGE_PATH]',
    )
    .replace(
      /(?:[A-Za-z0-9._~-]+[\\/]){2,}[^\s\\/()]+\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\b/gi,
      '[REDACTED_STORAGE_PATH]',
    )
    .replace(
      /(["'`])[^"'`\r\n]{1,160}\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\1/gi,
      '$1[REDACTED_FILE]$1',
    )
    .replace(
      /((?:\b(?:for|file(?:name)?|attachment)\b|파일(?:명)?)(?:\s*(?:is|은|는))?\s*[:=]?\s*)[^\\/\r\n]{1,160}\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\b/gi,
      '$1[REDACTED_FILE]',
    )
    .replace(
      /^\s*[^\\/\r\n]{1,160}\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\s*$/gi,
      '[REDACTED_FILE]',
    )
    .replace(
      /[^\s\\/()"'`]+[ \t]+[^\s\\/()"'`]+\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\b/gi,
      '[REDACTED_FILE]',
    )
    .replace(
      /[^\s\\/()]+\.(?:pdf|png|jpe?g|heic|heif|webp|gif|bmp|docx?|xlsx?|pptx?|csv|txt|hwp(?:x)?|rtf|zip)\b/gi,
      '[REDACTED_FILE]',
    );
};

const sanitizeString = (value: string): string => {
  return redactFileAndStoragePaths(
    maskPhoneString(maskResidentNumberString(redactOtpString(redactSecretString(value)))),
  );
};

const sanitizeValueForKey = (key: string, value: unknown, depth: number): unknown => {
  if (keyIncludes(key, SECRET_KEY_PARTS)) return '[REDACTED]';
  if (keyIncludes(key, RAW_BODY_KEY_PARTS)) return '[REDACTED_BODY]';
  if (keyIncludes(key, OTP_KEY_PARTS)) return '[REDACTED_OTP]';
  if (keyIncludes(key, FILE_KEY_PARTS)) return '[REDACTED_FILE]';
  if (keyIncludes(key, NAME_KEY_PARTS)) return '[REDACTED_NAME]';
  if (keyIncludes(key, RESIDENT_KEY_PARTS) && typeof value === 'string') {
    return maskPhoneString(maskResidentNumberString(value));
  }
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
      name: sanitizeString(value.name),
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

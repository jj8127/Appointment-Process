import { isHttpsResponseUrl } from './user-intent-policy.ts';

export type NoticePatchInput = {
  id?: string;
  title?: string;
  body?: string;
  category?: string;
  images?: string[];
  files?: { name: string; size?: number; type?: string; url: string }[];
};

export type NoticeDeleteInput = {
  id?: string;
};

export type NoticeMutationExpected = {
  id: string;
  title?: string;
  body?: string;
  category?: string;
  images?: string[];
  files?: { name: string; size?: number; type?: string; url: string }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';

const hasOwn = (value: Record<string, unknown>, key: string) => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const isExactJsonValue = (actual: unknown, expected: unknown): boolean => {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual)
      && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => isExactJsonValue(value, expected[index]));
  }
  if (!isRecord(actual) || !isRecord(expected)) return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => hasOwn(actual, key)
      && isExactJsonValue(actual[key], expected[key]));
};

const isNoticeFileInput = (value: unknown) => {
  if (!isRecord(value) || typeof value.name !== 'string' || !isHttpsResponseUrl(value.url)) {
    return false;
  }
  return (value.size === undefined
      || (typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0))
    && isOptionalString(value.type);
};

export function isNoticePatchInput(value: unknown): value is NoticePatchInput {
  if (!isRecord(value)
    || !isOptionalString(value.id)
    || !isOptionalString(value.title)
    || !isOptionalString(value.body)
    || !isOptionalString(value.category)) return false;
  if (value.images !== undefined
    && (!Array.isArray(value.images) || !value.images.every(isHttpsResponseUrl))) return false;
  return value.files === undefined
    || (Array.isArray(value.files) && value.files.every(isNoticeFileInput));
}

export function isNoticeDeleteInput(value: unknown): value is NoticeDeleteInput {
  return isRecord(value) && isOptionalString(value.id);
}

export function isExactNoticeMutationReceipt(
  value: unknown,
  expected: NoticeMutationExpected,
): boolean {
  if (!isRecord(value) || value.id !== expected.id) return false;
  return (['title', 'body', 'category', 'images', 'files'] as const).every((key) => (
    expected[key] === undefined
      || (hasOwn(value, key) && isExactJsonValue(value[key], expected[key]))
  ));
}

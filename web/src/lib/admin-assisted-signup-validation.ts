import { z } from 'zod';

import {
  SIGNUP_AFFILIATION_OPTIONS,
  SIGNUP_CARRIER_OPTIONS,
} from './signup-profile-options';

export const ADMIN_ASSISTED_LICENSE_OPTIONS = [
  { value: 'third', label: '제3 보험' },
  { value: 'life', label: '생명 보험' },
  { value: 'nonlife', label: '손해 보험' },
  { value: 'none', label: '없음' },
] as const;

export const ADMIN_ASSISTED_AFFILIATION_OPTIONS = SIGNUP_AFFILIATION_OPTIONS.map((value) => ({
  value,
  label: value,
}));

export const ADMIN_ASSISTED_CARRIER_OPTIONS = SIGNUP_CARRIER_OPTIONS.map((value) => ({
  value,
  label: value,
}));

const licenseStatusSchema = z.enum(['third', 'life', 'nonlife', 'none']);

function seoulDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const readPart = (type: 'year' | 'month' | 'day') => (
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  );
  return {
    year: readPart('year'),
    month: readPart('month'),
    day: readPart('day'),
  };
}

export function getSeoulTodayIsoDate(now = new Date()) {
  const { year, month, day } = seoulDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function seoulTodayEpochDay(now = new Date()) {
  const { year, month, day } = seoulDateParts(now);
  return Date.UTC(year, month - 1, day);
}

function parseIsoDateEpochDay(value: string) {
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const epochDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochDay);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return epochDay;
}

export const adminAssistedSignupSchema = z.object({
  requestId: z.string().uuid('요청 식별자가 올바르지 않습니다.'),
  name: z.string().trim().min(2, '이름을 2자 이상 입력해주세요.').max(40),
  phone: z.string().regex(/^01[0-9]{9}$/, '휴대폰 번호는 숫자 11자리로 입력해주세요.'),
  affiliation: z.enum(SIGNUP_AFFILIATION_OPTIONS),
  email: z.string().trim().email('이메일 주소를 확인해주세요.').max(160),
  carrier: z.enum(SIGNUP_CARRIER_OPTIONS),
  licenseStatuses: z.array(licenseStatusSchema).min(1, '보유 자격을 선택해주세요.').max(3),
  inviterFcId: z.string().uuid('추천인을 다시 검색해 선택해주세요.'),
  consentObtainedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '서면 확인일을 입력해주세요.'),
  evidenceReference: z.string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$/,
      '문서관리번호는 영문·숫자로 시작하는 4~64자의 영문, 숫자, 점, 밑줄, 빗금, 붙임표만 사용할 수 있습니다.',
    ),
  password: z.string()
    .min(8, '임시 비밀번호는 8자 이상이어야 합니다.')
    .max(128)
    .regex(/[A-Za-z]/, '임시 비밀번호에 영문을 포함해주세요.')
    .regex(/[0-9]/, '임시 비밀번호에 숫자를 포함해주세요.')
    .regex(/[^A-Za-z0-9]/, '임시 비밀번호에 특수문자를 포함해주세요.'),
  confirmPassword: z.string(),
  consentAttested: z.literal(true, {
    error: '서면 동의 확인 항목에 체크해주세요.',
  }),
}).superRefine((value, context) => {
  if (value.password !== value.confirmPassword) {
    context.addIssue({
      code: 'custom',
      path: ['confirmPassword'],
      message: '임시 비밀번호가 일치하지 않습니다.',
    });
  }

  if (value.licenseStatuses.includes('none') && value.licenseStatuses.length > 1) {
    context.addIssue({
      code: 'custom',
      path: ['licenseStatuses'],
      message: '보유 자격 없음은 다른 자격과 함께 선택할 수 없습니다.',
    });
  }

  const consentEpochDay = parseIsoDateEpochDay(value.consentObtainedOn);
  const todayEpochDay = seoulTodayEpochDay();
  const oldestAllowedEpochDay = todayEpochDay - 90 * 24 * 60 * 60 * 1000;
  if (
    consentEpochDay === null
    || consentEpochDay > todayEpochDay
    || consentEpochDay < oldestAllowedEpochDay
  ) {
    context.addIssue({
      code: 'custom',
      path: ['consentObtainedOn'],
      message: '서면 확인일은 오늘부터 90일 이내의 날짜여야 합니다.',
    });
  }
});

export type AdminAssistedSignupInput = z.infer<typeof adminAssistedSignupSchema>;

export type SignupReferralSearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string;
};

export function firstAdminAssistedSignupError(error: z.ZodError) {
  return error.issues[0]?.message ?? '입력 내용을 확인해주세요.';
}

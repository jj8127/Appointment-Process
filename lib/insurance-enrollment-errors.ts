import type { ReferralSearchResult } from '@/components/ReferralSearchField';
import { validateEmail } from '@/lib/validation';

export type EnrollmentField = 'affiliation' | 'email' | 'carrier' | 'referral';

/** Screen order; the first failing field is the one revealed. */
export const ENROLLMENT_FIELD_ORDER: EnrollmentField[] = ['affiliation', 'email', 'carrier', 'referral'];

export type EnrollmentFieldErrors = Partial<Record<EnrollmentField, string>>;

/** Inline messages shown under each field instead of a blocking dialog. */
export function getEnrollmentFieldErrors(input: {
  affiliation: string;
  email: string;
  carrier: string;
  searchQuery: string;
  selectedReferral: ReferralSearchResult | null;
  referralReady: boolean;
}): EnrollmentFieldErrors {
  const errors: EnrollmentFieldErrors = {};
  if (!input.affiliation.trim()) errors.affiliation = '소속을 선택해 주세요.';
  if (!input.email.trim()) errors.email = '이메일을 입력해 주세요.';
  else if (!validateEmail(input.email.trim()).isValid) errors.email = '이메일 주소를 다시 확인해 주세요.';
  if (!input.carrier.trim()) errors.carrier = '통신사를 선택해 주세요.';
  if (!input.selectedReferral) {
    errors.referral = input.searchQuery.trim() ? '검색 결과에서 추천인을 선택해 주세요.' : '보험 추천인을 검색해 선택해 주세요.';
  } else if (!input.referralReady) {
    errors.referral = '보험 추천인을 다시 선택해 주세요.';
  }
  return errors;
}

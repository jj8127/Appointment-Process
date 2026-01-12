/**
 * Validation utilities for FC Onboarding App
 *
 * Centralizes common validation logic to avoid duplication across components.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Phone number validation
 * - Must be exactly 11 digits (Korean mobile format)
 * - Strips non-digit characters before validation
 */
export function validatePhone(phone: string): ValidationResult {
  const digits = phone.replace(/[^0-9]/g, '');

  if (!digits) {
    return {
      isValid: false,
      error: '휴대폰 번호를 입력해주세요.',
    };
  }

  if (digits.length !== 11) {
    return {
      isValid: false,
      error: '휴대폰 번호는 숫자 11자리로 입력해주세요.',
    };
  }

  // Optional: Validate Korean mobile prefix (010, 011, 016, 017, 018, 019)
  const validPrefixes = ['010', '011', '016', '017', '018', '019'];
  const prefix = digits.substring(0, 3);

  if (!validPrefixes.includes(prefix)) {
    return {
      isValid: false,
      error: '올바른 휴대폰 번호 형식이 아닙니다.',
    };
  }

  return { isValid: true };
}

/**
 * Password validation
 * - Minimum 8 characters
 * - Must contain: English letters, numbers, and special characters
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || !password.trim()) {
    return {
      isValid: false,
      error: '비밀번호를 입력해주세요.',
    };
  }

  const trimmed = password.trim();

  if (trimmed.length < 8) {
    return {
      isValid: false,
      error: '비밀번호는 최소 8자 이상이어야 합니다.',
    };
  }

  // Check for English letters
  const hasEnglish = /[a-zA-Z]/.test(trimmed);
  if (!hasEnglish) {
    return {
      isValid: false,
      error: '비밀번호에 영문이 포함되어야 합니다.',
    };
  }

  // Check for numbers
  const hasNumber = /[0-9]/.test(trimmed);
  if (!hasNumber) {
    return {
      isValid: false,
      error: '비밀번호에 숫자가 포함되어야 합니다.',
    };
  }

  // Check for special characters
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(trimmed);
  if (!hasSpecial) {
    return {
      isValid: false,
      error: '비밀번호에 특수문자가 포함되어야 합니다.',
    };
  }

  return { isValid: true };
}

/**
 * Email validation
 * - Basic format check: localpart@domain.tld
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || !email.trim()) {
    return {
      isValid: false,
      error: '이메일을 입력해주세요.',
    };
  }

  const trimmed = email.trim();

  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmed)) {
    return {
      isValid: false,
      error: '올바른 이메일 형식이 아닙니다.',
    };
  }

  return { isValid: true };
}

/**
 * Name validation
 * - Must not be empty
 * - Minimum 2 characters
 */
export function validateName(name: string): ValidationResult {
  if (!name || !name.trim()) {
    return {
      isValid: false,
      error: '이름을 입력해주세요.',
    };
  }

  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return {
      isValid: false,
      error: '이름은 최소 2자 이상이어야 합니다.',
    };
  }

  return { isValid: true };
}

/**
 * Resident ID (주민번호) validation
 * - Must be exactly 13 digits
 * - First 6 digits: birth date (YYMMDD)
 * - 7th digit: gender code (1-4 for old format, 5-8 for new format)
 * - Checksum validation (13th digit)
 */
export function validateResidentId(residentId: string): ValidationResult {
  const digits = residentId.replace(/[^0-9]/g, '');

  if (!digits) {
    return {
      isValid: false,
      error: '주민등록번호를 입력해주세요.',
    };
  }

  if (digits.length !== 13) {
    return {
      isValid: false,
      error: '주민등록번호는 13자리 숫자여야 합니다.',
    };
  }

  // Validate gender digit (7th position)
  const genderDigit = parseInt(digits[6], 10);
  if (genderDigit < 1 || genderDigit > 8) {
    return {
      isValid: false,
      error: '올바르지 않은 주민등록번호입니다.',
    };
  }

  // Checksum validation
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;

  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }

  const checksum = (11 - (sum % 11)) % 10;
  const lastDigit = parseInt(digits[12], 10);

  if (checksum !== lastDigit) {
    return {
      isValid: false,
      error: '올바르지 않은 주민등록번호입니다.',
    };
  }

  return { isValid: true };
}

/**
 * Required field validation
 * - Generic check for non-empty values
 */
export function validateRequired(value: string, fieldName: string): ValidationResult {
  if (!value || !value.trim()) {
    return {
      isValid: false,
      error: `${fieldName}을(를) 입력해주세요.`,
    };
  }

  return { isValid: true };
}

/**
 * Normalize phone number
 * - Strips all non-digit characters
 * - Returns clean 11-digit string
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Format phone number for display
 * - Converts "01012345678" to "010-1234-5678"
 */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);

  if (digits.length !== 11) {
    return phone;
  }

  return `${digits.substring(0, 3)}-${digits.substring(3, 7)}-${digits.substring(7)}`;
}

/**
 * Format resident ID for display
 * - Converts "1234561234567" to "123456-1******"
 */
export function formatResidentId(residentId: string): string {
  const digits = residentId.replace(/[^0-9]/g, '');

  if (digits.length !== 13) {
    return residentId;
  }

  return `${digits.substring(0, 6)}-${digits[6]}******`;
}

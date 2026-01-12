import {
  validatePhone,
  validatePassword,
  validateEmail,
  validateName,
  validateResidentId,
  validateRequired,
  normalizePhone,
  formatPhone,
  formatResidentId,
} from '../validation';

describe('validatePhone', () => {
  it('should validate correct phone number', () => {
    const result = validatePhone('01012345678');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should validate phone number with hyphens', () => {
    const result = validatePhone('010-1234-5678');
    expect(result.isValid).toBe(true);
  });

  it('should reject empty phone number', () => {
    const result = validatePhone('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('휴대폰 번호를 입력해주세요.');
  });

  it('should reject phone number with wrong length', () => {
    const result = validatePhone('0101234567');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('휴대폰 번호는 숫자 11자리로 입력해주세요.');
  });

  it('should reject phone number with invalid prefix', () => {
    const result = validatePhone('02012345678');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바른 휴대폰 번호 형식이 아닙니다.');
  });

  it('should validate all Korean mobile prefixes', () => {
    const prefixes = ['010', '011', '016', '017', '018', '019'];
    prefixes.forEach((prefix) => {
      const result = validatePhone(`${prefix}12345678`);
      expect(result.isValid).toBe(true);
    });
  });
});

describe('validatePassword', () => {
  it('should validate correct password', () => {
    const result = validatePassword('Test1234!');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty password', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('비밀번호를 입력해주세요.');
  });

  it('should reject password shorter than 8 characters', () => {
    const result = validatePassword('Test1!');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('비밀번호는 최소 8자 이상이어야 합니다.');
  });

  it('should reject password without English letters', () => {
    const result = validatePassword('12345678!');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('비밀번호에 영문이 포함되어야 합니다.');
  });

  it('should reject password without numbers', () => {
    const result = validatePassword('Testtest!');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('비밀번호에 숫자가 포함되어야 합니다.');
  });

  it('should reject password without special characters', () => {
    const result = validatePassword('Test1234');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('비밀번호에 특수문자가 포함되어야 합니다.');
  });

  it('should trim whitespace before validation', () => {
    const result = validatePassword('  Test1234!  ');
    expect(result.isValid).toBe(true);
  });
});

describe('validateEmail', () => {
  it('should validate correct email', () => {
    const result = validateEmail('test@example.com');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty email', () => {
    const result = validateEmail('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('이메일을 입력해주세요.');
  });

  it('should reject email without @', () => {
    const result = validateEmail('testexample.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바른 이메일 형식이 아닙니다.');
  });

  it('should reject email without domain', () => {
    const result = validateEmail('test@');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바른 이메일 형식이 아닙니다.');
  });

  it('should reject email without TLD', () => {
    const result = validateEmail('test@example');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바른 이메일 형식이 아닙니다.');
  });

  it('should trim whitespace before validation', () => {
    const result = validateEmail('  test@example.com  ');
    expect(result.isValid).toBe(true);
  });
});

describe('validateName', () => {
  it('should validate correct name', () => {
    const result = validateName('홍길동');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty name', () => {
    const result = validateName('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('이름을 입력해주세요.');
  });

  it('should reject name shorter than 2 characters', () => {
    const result = validateName('홍');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('이름은 최소 2자 이상이어야 합니다.');
  });

  it('should trim whitespace before validation', () => {
    const result = validateName('  홍길동  ');
    expect(result.isValid).toBe(true);
  });
});

describe('validateResidentId', () => {
  // Helper function to calculate checksum
  function calculateChecksum(digits: string): number {
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(digits[i], 10) * weights[i];
    }
    return (11 - (sum % 11)) % 10;
  }

  // Valid test cases with correct checksum
  it('should validate correct resident ID', () => {
    // Generate valid resident ID: 900101-1234567
    const base = '900101123456';
    const checksum = calculateChecksum(base);
    const validId = base + checksum;

    const result = validateResidentId(validId);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should validate resident ID with hyphen', () => {
    const base = '900101123456';
    const checksum = calculateChecksum(base);
    const validId = `${base.substring(0, 6)}-${base.substring(6)}${checksum}`;

    const result = validateResidentId(validId);
    expect(result.isValid).toBe(true);
  });

  it('should reject empty resident ID', () => {
    const result = validateResidentId('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('주민등록번호를 입력해주세요.');
  });

  it('should reject resident ID with wrong length', () => {
    const result = validateResidentId('900101123456');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('주민등록번호는 13자리 숫자여야 합니다.');
  });

  it('should reject resident ID with invalid gender digit', () => {
    const result = validateResidentId('9001010234567');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바르지 않은 주민등록번호입니다.');
  });

  it('should reject resident ID with wrong checksum', () => {
    const result = validateResidentId('9001011234560');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('올바르지 않은 주민등록번호입니다.');
  });

  it('should validate all gender digits (1-8)', () => {
    // Generate valid IDs for each gender digit (1-8)
    for (let gender = 1; gender <= 8; gender++) {
      const base = `90010${gender}123456`;
      const checksum = calculateChecksum(base.substring(0, 12));
      const validId = base.substring(0, 12) + checksum;

      const result = validateResidentId(validId);
      expect(result.isValid).toBe(true);
    }
  });
});

describe('validateRequired', () => {
  it('should validate non-empty value', () => {
    const result = validateRequired('test', '필드');
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject empty value', () => {
    const result = validateRequired('', '필드');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('필드을(를) 입력해주세요.');
  });

  it('should reject whitespace-only value', () => {
    const result = validateRequired('   ', '필드');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('필드을(를) 입력해주세요.');
  });

  it('should customize error message with field name', () => {
    const result = validateRequired('', '추천인');
    expect(result.error).toBe('추천인을(를) 입력해주세요.');
  });
});

describe('normalizePhone', () => {
  it('should remove all non-digit characters', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
  });

  it('should handle phone with spaces', () => {
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
  });

  it('should handle phone with parentheses', () => {
    expect(normalizePhone('(010)1234-5678')).toBe('01012345678');
  });

  it('should return same string if already normalized', () => {
    expect(normalizePhone('01012345678')).toBe('01012345678');
  });
});

describe('formatPhone', () => {
  it('should format phone number correctly', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
  });

  it('should return original if length is not 11', () => {
    expect(formatPhone('0101234567')).toBe('0101234567');
  });

  it('should handle already formatted phone', () => {
    expect(formatPhone('010-1234-5678')).toBe('010-1234-5678');
  });
});

describe('formatResidentId', () => {
  it('should format resident ID correctly', () => {
    expect(formatResidentId('9001011234567')).toBe('900101-1******');
  });

  it('should return original if length is not 13', () => {
    expect(formatResidentId('900101123456')).toBe('900101123456');
  });

  it('should handle already formatted resident ID', () => {
    expect(formatResidentId('900101-1234567')).toBe('900101-1******');
  });

  it('should mask all digits except first 7', () => {
    const formatted = formatResidentId('9001011234567');
    expect(formatted).toContain('******');
    expect(formatted).toContain('900101-1');
  });
});

import {
  formatRequestBoardCustomerBirthDateInput,
  formatRequestBoardThreeDigitNumberInput,
  formatRequestBoardCustomerPhoneInput,
  formatRequestBoardCustomerSsnInput,
  isCompleteRequestBoardCustomerBirthDate,
  isCompleteRequestBoardCustomerPhone,
  isCompleteRequestBoardCustomerSsn,
  isValidRequestBoardCustomerBirthDate,
} from '@/lib/request-board-customer-input';

describe('request board customer input helpers', () => {
  it('formats birth date input as year, month, and day are typed', () => {
    expect(formatRequestBoardCustomerBirthDateInput('')).toBe('');
    expect(formatRequestBoardCustomerBirthDateInput('199')).toBe('199');
    expect(formatRequestBoardCustomerBirthDateInput('1990')).toBe('1990');
    expect(formatRequestBoardCustomerBirthDateInput('19901')).toBe('1990-1');
    expect(formatRequestBoardCustomerBirthDateInput('199012')).toBe('1990-12');
    expect(formatRequestBoardCustomerBirthDateInput('1990123')).toBe('1990-12-3');
    expect(formatRequestBoardCustomerBirthDateInput('19901231')).toBe('1990-12-31');
    expect(formatRequestBoardCustomerBirthDateInput('1990-12-31')).toBe('1990-12-31');
  });

  it('detects complete birth date input from eight digits', () => {
    expect(isCompleteRequestBoardCustomerBirthDate('1990-12-3')).toBe(false);
    expect(isCompleteRequestBoardCustomerBirthDate('1990-12-31')).toBe(true);
  });

  it('validates birth dates semantically instead of accepting any eight digits', () => {
    expect(isValidRequestBoardCustomerBirthDate('1990-12-31')).toBe(true);
    expect(isValidRequestBoardCustomerBirthDate('1990-02-29')).toBe(false);
    expect(isValidRequestBoardCustomerBirthDate('1991-02-29')).toBe(false);
    expect(isValidRequestBoardCustomerBirthDate('1990-13-01')).toBe(false);
    expect(isValidRequestBoardCustomerBirthDate('1990-00-01')).toBe(false);
    expect(isValidRequestBoardCustomerBirthDate('1990-12-32')).toBe(false);
    expect(isValidRequestBoardCustomerBirthDate('1990-12-3')).toBe(false);
  });

  it('normalizes height and weight to three numeric digits', () => {
    expect(formatRequestBoardThreeDigitNumberInput('')).toBe('');
    expect(formatRequestBoardThreeDigitNumberInput('17a')).toBe('17');
    expect(formatRequestBoardThreeDigitNumberInput('170cm')).toBe('170');
    expect(formatRequestBoardThreeDigitNumberInput('1700')).toBe('170');
  });

  it('formats phone input with automatic hyphens while typing', () => {
    expect(formatRequestBoardCustomerPhoneInput('')).toBe('');
    expect(formatRequestBoardCustomerPhoneInput('010')).toBe('010');
    expect(formatRequestBoardCustomerPhoneInput('0101')).toBe('010-1');
    expect(formatRequestBoardCustomerPhoneInput('0101234')).toBe('010-1234');
    expect(formatRequestBoardCustomerPhoneInput('01012341')).toBe('010-1234-1');
    expect(formatRequestBoardCustomerPhoneInput('01012341234')).toBe('010-1234-1234');
    expect(formatRequestBoardCustomerPhoneInput('010-1234-1234')).toBe('010-1234-1234');
  });

  it('detects complete phone input from eleven digits', () => {
    expect(isCompleteRequestBoardCustomerPhone('010-1234-123')).toBe(false);
    expect(isCompleteRequestBoardCustomerPhone('010-1234-1234')).toBe(true);
  });

  it('formats resident number input with an automatic hyphen after six digits', () => {
    expect(formatRequestBoardCustomerSsnInput('')).toBe('');
    expect(formatRequestBoardCustomerSsnInput('90010')).toBe('90010');
    expect(formatRequestBoardCustomerSsnInput('900101')).toBe('900101');
    expect(formatRequestBoardCustomerSsnInput('9001011')).toBe('900101-1');
    expect(formatRequestBoardCustomerSsnInput('9001011234567')).toBe('900101-1234567');
    expect(formatRequestBoardCustomerSsnInput('900101-1234567')).toBe('900101-1234567');
  });

  it('detects complete resident number input from thirteen digits', () => {
    expect(isCompleteRequestBoardCustomerSsn('900101-123456')).toBe(false);
    expect(isCompleteRequestBoardCustomerSsn('900101-1234567')).toBe(true);
  });
});

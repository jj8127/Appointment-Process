export function formatRequestBoardCustomerBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function isCompleteRequestBoardCustomerBirthDate(value: string) {
  return value.replace(/\D/g, '').length >= 8;
}

export function isValidRequestBoardCustomerBirthDate(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return false;

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function formatRequestBoardCustomerPhoneInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function isCompleteRequestBoardCustomerPhone(value: string) {
  return value.replace(/\D/g, '').length >= 11;
}

export function formatRequestBoardCustomerSsnInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) {
    return digits;
  }
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export function isCompleteRequestBoardCustomerSsn(value: string) {
  return value.replace(/\D/g, '').length >= 13;
}

export function formatRequestBoardThreeDigitNumberInput(value: string) {
  return value.replace(/\D/g, '').slice(0, 3);
}

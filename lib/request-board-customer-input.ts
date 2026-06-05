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

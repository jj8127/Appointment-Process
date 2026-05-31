function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function buildPhoneCandidates(rawResidentId: string, residentDigits: string): string[] {
  const values = new Set<string>();
  const raw = String(rawResidentId ?? '').trim();
  const formatted = formatPhone(residentDigits);

  if (raw) values.add(raw);
  if (residentDigits) values.add(residentDigits);
  if (formatted) values.add(formatted);

  return Array.from(values);
}

export type FcSearchRow = { id: string; name: string; phone: string; affiliation: string };

// Name and affiliation match by substring; a query with 3+ digits also matches phone digits.
export function searchFcRows<T extends FcSearchRow>(rows: readonly T[], query: string, limit = 20): T[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const digits = text.replace(/[^0-9]/g, '');
  const matches: T[] = [];
  for (const row of rows) {
    const byText = row.name.toLowerCase().includes(text) || row.affiliation.toLowerCase().includes(text);
    const byPhone = digits.length >= 3 && row.phone.replace(/[^0-9]/g, '').includes(digits);
    if (byText || byPhone) {
      matches.push(row);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

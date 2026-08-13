const DESIGNER_MARKER = '설계매니저';

export const normalizeDashboardIdentityPhone = (value?: string | null): string =>
  String(value ?? '').replace(/\D/g, '');

export const buildActiveManagerPhoneSet = (
  rows: Array<{ phone?: string | null }>,
): Set<string> =>
  new Set(
    rows
      .map((row) => normalizeDashboardIdentityPhone(row.phone))
      .filter(Boolean),
  );

export const isDashboardFcOnlyRow = (
  row: { affiliation?: string | null; phone?: string | null },
  activeManagerPhones: ReadonlySet<string>,
): boolean => {
  const affiliation = String(row.affiliation ?? '').replace(/\s+/g, '');
  const phone = normalizeDashboardIdentityPhone(row.phone);

  return (
    !affiliation.includes(DESIGNER_MARKER) &&
    (!phone || !activeManagerPhones.has(phone))
  );
};

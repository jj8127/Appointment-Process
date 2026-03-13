export const normalizeRequestBoardFcAffiliation = (
  value?: string | null,
): string | undefined => {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
};

const collapseIdentityText = (value?: string | null): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s·().\-_/]/g, '')
    .trim();

export const formatRequestBoardFcDisplayName = (
  name?: string | null,
  affiliation?: string | null,
): string => {
  const normalizedName = String(name ?? '').trim() || 'FC';
  const normalizedAffiliation = normalizeRequestBoardFcAffiliation(affiliation);

  if (!normalizedAffiliation) {
    return normalizedName;
  }

  if (collapseIdentityText(normalizedAffiliation).includes(collapseIdentityText(normalizedName))) {
    return normalizedAffiliation;
  }

  return normalizedAffiliation
    ? `${normalizedAffiliation} · ${normalizedName}`
    : normalizedName;
};

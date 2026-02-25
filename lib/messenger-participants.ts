export const ADMIN_CHAT_ID = 'admin';

const MANAGER_SUFFIX_PATTERN = /\s*본부장(?:님)?\s*$/;

const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();

export const sanitizePhone = (value?: string | null) => (value ?? '').replace(/[^0-9]/g, '');

export const stripManagerSuffix = (value?: string | null) => normalizeWhitespace(value).replace(MANAGER_SUFFIX_PATTERN, '').trim();

export const normalizeNameForMatch = (value?: string | null) =>
  stripManagerSuffix(value).replace(/\s+/g, '').trim().toLowerCase();

export const isSameManagerName = (left?: string | null, right?: string | null) => {
  const a = normalizeNameForMatch(left);
  const b = normalizeNameForMatch(right);
  if (!a || !b) return false;
  return a === b;
};

export type AffiliationManagerInfo = {
  affiliationLabel: string;
  managerName: string;
};

export const parseAffiliationManagerInfo = (affiliation?: string | null): AffiliationManagerInfo | null => {
  const raw = normalizeWhitespace(affiliation);
  if (!raw) return null;

  let affiliationLabel = raw;
  let managerNameCandidate = '';

  if (raw.includes(':')) {
    const [left, right] = raw.split(':', 2);
    affiliationLabel = normalizeWhitespace(left);
    managerNameCandidate = normalizeWhitespace(right);
  } else {
    const bracketed = raw.match(/\[본부장\s*:\s*([^\]]+)\]/);
    if (bracketed?.[1]) {
      managerNameCandidate = normalizeWhitespace(bracketed[1]);
      affiliationLabel = normalizeWhitespace(raw.replace(/\[본부장\s*:\s*[^\]]+\]/, ''));
    }
  }

  const managerName = stripManagerSuffix(managerNameCandidate);
  const finalAffiliation = affiliationLabel || raw;
  if (!managerName) return null;
  return { affiliationLabel: finalAffiliation, managerName };
};

export const buildManagerChatLabel = (affiliation?: string | null, managerNameOverride?: string | null) => {
  const info = parseAffiliationManagerInfo(affiliation);
  const managerName = stripManagerSuffix(managerNameOverride) || info?.managerName || '';
  const affiliationLabel = info?.affiliationLabel || normalizeWhitespace(affiliation);

  if (affiliationLabel && managerName) return `${affiliationLabel} ${managerName}`;
  if (managerName) return managerName;
  if (affiliationLabel) return affiliationLabel;
  return '총무팀';
};

export const SIGNUP_AFFILIATION_OPTIONS = [
  '1본부 서선미',
  '2본부 박성훈',
  '3본부 김태희',
  '4본부 현경숙',
  '5본부 최철준',
  '6본부 김정수(박선희)',
  '7본부 이동훈',
  '8본부 정승철',
  '9본부 이현욱(김주용)',
  '10본부 이수민',
] as const;

export const SIGNUP_CARRIER_OPTIONS = [
  'SKT',
  'KT',
  'LGU+',
  'SKT 알뜰폰',
  'KT 알뜰폰',
  'LGU+ 알뜰폰',
] as const;

/** Common mail domains suggested after the local part of an address. */
export const SIGNUP_EMAIL_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'nate.com'] as const;
export const EMAIL_DOMAIN_DIRECT_INPUT = '직접 입력';
export const SIGNUP_EMAIL_DOMAIN_CHOICES: string[] = [...SIGNUP_EMAIL_DOMAINS, EMAIL_DOMAIN_DIRECT_INPUT];

/** Compose the address only when both parts exist; otherwise keep the partial input for validation. */
export function composeEmail(local: string, domainChoice: string, customDomain: string): string {
  const domain = domainChoice === EMAIL_DOMAIN_DIRECT_INPUT ? customDomain.trim() : domainChoice;
  return local.trim() && domain ? `${local.trim()}@${domain}` : local.trim();
}

export type SignupAffiliation = (typeof SIGNUP_AFFILIATION_OPTIONS)[number];
export type SignupCarrier = (typeof SIGNUP_CARRIER_OPTIONS)[number];

const MANAGER_NAME_TO_AFFILIATION: Record<string, string> = {
  '서선미': '1본부 서선미',
  '박성훈': '2본부 박성훈',
  '김태희': '3본부 김태희',
  '현경숙': '4본부 현경숙',
  '최철준': '5본부 최철준',
  '김정수': '6본부 김정수(박선희)',
  '박선희': '6본부 김정수(박선희)',
  '김동훈': '7본부 김동훈',
  '정승철': '8본부 정승철',
  '이현욱': '9본부 이현욱(김주용)',
  '김주용': '9본부 이현욱(김주용)',
  '이현옥': '9본부 이현욱(김주용)',
};

const normalizeManagerName = (value?: string | null): string =>
  String(value ?? '').replace(/\s+/g, '').trim();

export const resolveManagerAffiliation = (managerName?: string | null): string | null => {
  const normalizedName = normalizeManagerName(managerName);
  if (!normalizedName) {
    return null;
  }

  return MANAGER_NAME_TO_AFFILIATION[normalizedName] ?? null;
};

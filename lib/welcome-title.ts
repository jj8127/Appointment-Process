type UserRole = 'admin' | 'fc' | null | undefined;

type BuildWelcomeTitleParams = {
  role: UserRole;
  readOnly?: boolean;
  isRequestBoardDesigner?: boolean;
  displayName?: string | null;
  fcName?: string | null;
  fallbackTitle?: string;
};

export function buildWelcomeTitle({
  role,
  readOnly = false,
  isRequestBoardDesigner = false,
  displayName,
  fcName,
  fallbackTitle = '홈',
}: BuildWelcomeTitleParams): string {
  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
  const normalizedFcName = typeof fcName === 'string' ? fcName.trim() : '';
  const normalizedDesignerBaseName = normalizedDisplayName
    .replace(/\s*설계\s*매니저$/, '')
    .replace(/\s*설계매니저$/, '')
    .trim();

  if (isRequestBoardDesigner) {
    return normalizedDesignerBaseName
      ? `${normalizedDesignerBaseName} 설계 매니저님 환영합니다.`
      : '설계 매니저님 환영합니다.';
  }

  if (role === 'fc') {
    return `${normalizedFcName || normalizedDisplayName || 'FC'}님 환영합니다.`;
  }

  if (role === 'admin') {
    if (readOnly) {
      const managerBaseName = normalizedDisplayName.replace(/\s+/g, '').replace(/본부장$/, '').trim();
      return managerBaseName ? `${managerBaseName} 본부장님 환영합니다.` : '본부장님 환영합니다.';
    }
    return '총무님 환영합니다.';
  }

  return fallbackTitle;
}

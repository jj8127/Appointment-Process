type AppRole = 'admin' | 'fc' | null;
type AdminHomeTab = 'onboarding' | 'exam';

export type ExamHomeSurface = 'admin-management' | 'fc-apply' | 'none';

export function canUseFcExamApply(input: {
  role: AppRole;
  readOnly?: boolean | null;
}) {
  return input.role === 'fc' || (input.role === 'admin' && input.readOnly === true);
}

export function resolveExamHomeSurface(input: {
  role: AppRole;
  readOnly?: boolean | null;
  adminHomeTab?: AdminHomeTab;
}): ExamHomeSurface {
  if (input.role === 'admin' && input.adminHomeTab === 'exam') {
    return input.readOnly === true ? 'fc-apply' : 'admin-management';
  }

  if (input.role === 'fc') {
    return 'fc-apply';
  }

  return 'none';
}

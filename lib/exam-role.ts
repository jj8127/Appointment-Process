type AppRole = 'admin' | 'fc' | null;
type AdminHomeTab = 'onboarding' | 'exam';
type StaffType = 'admin' | 'developer' | null;

export type ExamHomeSurface = 'admin-management' | 'manager-management' | 'fc-apply' | 'none';

export function canUseFcExamApply(input: {
  role: AppRole;
  readOnly?: boolean | null;
  staffType?: StaffType;
}) {
  return input.role === 'fc'
    || (
      input.role === 'admin'
      && (
        input.readOnly === true
        || input.staffType === 'admin'
        || input.staffType === 'developer'
      )
    );
}

export function isExamProxyApplicationActor(input: {
  role: AppRole;
  readOnly?: boolean | null;
  staffType?: StaffType;
}) {
  return input.role === 'admin'
    && (
      input.readOnly === true
      || input.staffType === 'admin'
      || input.staffType === 'developer'
    );
}

export function resolveExamHomeSurface(input: {
  role: AppRole;
  readOnly?: boolean | null;
  adminHomeTab?: AdminHomeTab;
}): ExamHomeSurface {
  if (input.role === 'admin' && input.adminHomeTab === 'exam') {
    return input.readOnly === true ? 'manager-management' : 'admin-management';
  }

  if (input.role === 'fc') {
    return 'fc-apply';
  }

  return 'none';
}

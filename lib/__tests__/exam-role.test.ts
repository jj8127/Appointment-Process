import {
  canUseFcExamApply,
  resolveExamHomeSurface,
} from '../exam-role';

describe('exam role contract', () => {
  test('treats manager read-only sessions as FC-equivalent for exam application', () => {
    expect(canUseFcExamApply({ role: 'fc' })).toBe(true);
    expect(canUseFcExamApply({ role: 'admin', readOnly: true })).toBe(true);
  });

  test('allows general-affairs and developer staff to apply for another FC', () => {
    expect(canUseFcExamApply({ role: 'admin', readOnly: false, staffType: 'admin' })).toBe(true);
    expect(canUseFcExamApply({ role: 'admin', readOnly: false, staffType: 'developer' })).toBe(true);
    expect(resolveExamHomeSurface({ role: 'admin', readOnly: false, adminHomeTab: 'exam' })).toBe('admin-management');
  });

  test('keeps manager exam home on management surface while allowing exam application', () => {
    expect(resolveExamHomeSurface({ role: 'admin', readOnly: true, adminHomeTab: 'exam' })).toBe('manager-management');
    expect(canUseFcExamApply({ role: 'admin', readOnly: true })).toBe(true);
  });
});

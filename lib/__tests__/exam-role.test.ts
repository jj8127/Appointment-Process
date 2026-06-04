import {
  canUseFcExamApply,
  resolveExamHomeSurface,
} from '../exam-role';

describe('exam role contract', () => {
  test('treats manager read-only sessions as FC-equivalent for exam application', () => {
    expect(canUseFcExamApply({ role: 'fc' })).toBe(true);
    expect(canUseFcExamApply({ role: 'admin', readOnly: true })).toBe(true);
  });

  test('keeps writable admin sessions on exam management surface', () => {
    expect(canUseFcExamApply({ role: 'admin', readOnly: false })).toBe(false);
    expect(resolveExamHomeSurface({ role: 'admin', readOnly: false, adminHomeTab: 'exam' })).toBe('admin-management');
  });

  test('uses FC apply surface for manager exam home tab', () => {
    expect(resolveExamHomeSurface({ role: 'admin', readOnly: true, adminHomeTab: 'exam' })).toBe('fc-apply');
  });
});

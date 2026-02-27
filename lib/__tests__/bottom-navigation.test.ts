import {
  resolveBottomNavActiveKey,
  resolveBottomNavPreset,
} from '@/lib/bottom-navigation';

describe('bottom navigation resolver', () => {
  it('returns null before hydration', () => {
    expect(
      resolveBottomNavPreset({
        role: 'admin',
        readOnly: false,
        hydrated: false,
      }),
    ).toBeNull();
  });

  it('prioritizes request-board designer preset for fc role', () => {
    expect(
      resolveBottomNavPreset({
        role: 'fc',
        hydrated: true,
        isRequestBoardDesigner: true,
      }),
    ).toBe('request-board-designer');
  });

  it('admin with isRequestBoardDesigner does not get designer preset', () => {
    // 총무(admin, readOnly=false)는 isRequestBoardDesigner가 true여도 admin 프리셋 유지
    expect(
      resolveBottomNavPreset({
        role: 'admin',
        readOnly: false,
        hydrated: true,
        isRequestBoardDesigner: true,
      }),
    ).toBe('admin-onboarding');
    // 본부장(admin, readOnly=true)도 동일하게 manager 프리셋 유지
    expect(
      resolveBottomNavPreset({
        role: 'admin',
        readOnly: true,
        hydrated: true,
        isRequestBoardDesigner: true,
      }),
    ).toBe('manager');
  });

  it('maps admin + readOnly to manager preset', () => {
    expect(
      resolveBottomNavPreset({
        role: 'admin',
        readOnly: true,
        hydrated: true,
      }),
    ).toBe('manager');
  });

  it('maps admin tab mode to admin preset', () => {
    expect(
      resolveBottomNavPreset(
        {
          role: 'admin',
          readOnly: false,
          hydrated: true,
        },
        { adminHomeTab: 'exam' },
      ),
    ).toBe('admin-exam');

    expect(
      resolveBottomNavPreset(
        {
          role: 'admin',
          readOnly: false,
          hydrated: true,
        },
        { adminHomeTab: 'onboarding' },
      ),
    ).toBe('admin-onboarding');
  });

  it('maps fc to fc preset', () => {
    expect(
      resolveBottomNavPreset({
        role: 'fc',
        hydrated: true,
      }),
    ).toBe('fc');
  });

  it('falls back active key to preset first key when preferred is missing', () => {
    expect(resolveBottomNavActiveKey('manager', 'home')).toBe('onboarding');
    expect(resolveBottomNavActiveKey('request-board-designer', 'board')).toBe('request-board');
  });

  it('keeps active key when preferred exists', () => {
    expect(resolveBottomNavActiveKey('manager', 'settings')).toBe('settings');
    expect(resolveBottomNavActiveKey('admin-onboarding', 'exam')).toBe('exam');
  });
});

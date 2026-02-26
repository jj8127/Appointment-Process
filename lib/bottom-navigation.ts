export type BottomNavPreset =
  | 'fc'
  | 'admin-onboarding'
  | 'admin-exam'
  | 'manager'
  | 'request-board-designer';

type BottomNavRole = 'admin' | 'fc' | null;
type BottomNavKey = 'home' | 'board' | 'request-board' | 'settings' | 'onboarding' | 'exam';

type ResolveBottomNavPresetInput = {
  role: BottomNavRole;
  readOnly?: boolean;
  hydrated?: boolean;
  isRequestBoardDesigner?: boolean;
};

type ResolveBottomNavPresetOptions = {
  adminHomeTab?: 'onboarding' | 'exam';
};

const PRESET_KEYS: Record<BottomNavPreset, BottomNavKey[]> = {
  fc: ['home', 'board', 'request-board', 'settings'],
  'admin-onboarding': ['onboarding', 'exam', 'request-board', 'board', 'settings'],
  'admin-exam': ['onboarding', 'exam', 'request-board', 'board', 'settings'],
  manager: ['onboarding', 'exam', 'request-board', 'board', 'settings'],
  'request-board-designer': ['request-board', 'settings'],
};

/**
 * 앱 전역 하단 네비게이션 프리셋 결정 규칙(SSOT).
 * - hydrate 전에는 null 반환(잘못된 초기 프리셋 깜빡임 방지)
 * - request_board 설계매니저 플래그가 최우선
 * - role=admin + readOnly=true 는 manager 프리셋으로 고정
 */
export function resolveBottomNavPreset(
  input: ResolveBottomNavPresetInput,
  options?: ResolveBottomNavPresetOptions,
): BottomNavPreset | null {
  if (input.hydrated === false) return null;
  if (input.isRequestBoardDesigner) return 'request-board-designer';

  if (input.role === 'admin') {
    if (input.readOnly) return 'manager';
    return options?.adminHomeTab === 'exam' ? 'admin-exam' : 'admin-onboarding';
  }

  if (input.role === 'fc') return 'fc';
  return null;
}

export function resolveBottomNavActiveKey(
  preset: BottomNavPreset | null,
  preferredKey: string,
): string {
  if (!preset) return preferredKey;
  const keys = PRESET_KEYS[preset];
  if (keys.includes(preferredKey as BottomNavKey)) return preferredKey;
  return keys[0] ?? preferredKey;
}

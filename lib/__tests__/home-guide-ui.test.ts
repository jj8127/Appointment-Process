import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HOME_GUIDE_ICON_BACKGROUND,
  HOME_GUIDE_ICON_FOREGROUND,
  getHomeGuideIconVisualContract,
} from '@/lib/home-guide-ui';

describe('home guide icon visual contract', () => {
  it('uses a static orange badge instead of a black or transparent fallback', () => {
    const contract = getHomeGuideIconVisualContract();

    expect(contract.backgroundColor).toBe(HOME_GUIDE_ICON_BACKGROUND);
    expect(contract.foregroundColor).toBe(HOME_GUIDE_ICON_FOREGROUND);
    expect(Object.values(contract).map((value) => value.toLowerCase())).not.toContain('#000000');
    expect(Object.values(contract).map((value) => value.toLowerCase())).not.toContain('black');
  });

  it('opens the app guides from the home 사용법 shortcut instead of standing guide cards', () => {
    const homeSource = readFileSync(join(process.cwd(), 'app/index.tsx'), 'utf8');
    const shortcutsSource = readFileSync(join(process.cwd(), 'components/fc-home/FcHomeShortcuts.tsx'), 'utf8');

    expect(homeSource).toContain('onHowTo={openHowToOptions}');
    expect(homeSource).toContain("{ text: '홈 화면 안내', onPress: startFcTour }");
    expect(homeSource).toContain("{ text: '바로가기 안내', onPress: startShortcutGuide }");
    expect(homeSource).not.toContain('앱 사용법 안내 시작하기');
    expect(homeSource).not.toContain('바로가기 사용법 설명 듣기');
    expect(shortcutsSource).toContain('label="사용법"');
  });
});

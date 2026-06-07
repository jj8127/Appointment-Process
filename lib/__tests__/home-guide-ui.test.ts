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
});

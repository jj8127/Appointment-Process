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

  it('keeps the mobile home guide play badge out of vector-icon and elevated-circle fallback paths', () => {
    const homeSource = readFileSync(join(process.cwd(), 'app/index.tsx'), 'utf8');
    const guideBadgeStyle = homeSource.slice(
      homeSource.indexOf('guideIconBadgeNew:'),
      homeSource.indexOf('guideTextWrapNew:'),
    );

    expect(homeSource).toContain('styles.guidePlayTriangle');
    expect(homeSource).not.toContain('<Feather name="play"');
    expect(guideBadgeStyle).toContain('shadowOpacity: 0');
    expect(guideBadgeStyle).toContain('elevation: 0');
    expect(guideBadgeStyle).not.toContain("shadowColor: '#000'");
  });
});

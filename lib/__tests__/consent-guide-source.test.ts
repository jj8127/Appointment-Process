import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('allowance consent guide image layout', () => {
  it('gives the horizontal guide list an explicit height so images are visible inside the scroll view', () => {
    const consentSource = readFileSync(join(process.cwd(), 'app/consent.tsx'), 'utf8');

    expect(consentSource).toContain('style={[styles.guideList, { height: cardHeight }]}');
    expect(consentSource).toContain('guideList:');
  });
});

import fs from 'fs';
import path from 'path';

describe('AppAlertProvider source contract', () => {
  it('uses StatusGlyph instead of font-backed icon assets', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'AppAlertProvider.tsx'),
      'utf8',
    );

    expect(source).toContain("import StatusGlyph from '@/components/StatusGlyph';");
    expect(source).not.toContain('@expo/vector-icons');
    expect(source).not.toContain('<Feather');
  });
});

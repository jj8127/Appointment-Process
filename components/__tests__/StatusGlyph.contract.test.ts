import fs from 'fs';
import path from 'path';

describe('StatusGlyph source contract', () => {
  it('renders status icons with svg paths instead of icon fonts', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'StatusGlyph.tsx'),
      'utf8',
    );

    expect(source).toContain("from 'react-native-svg'");
    expect(source).not.toContain('@expo/vector-icons');
    expect(source).not.toContain('Feather');
  });
});

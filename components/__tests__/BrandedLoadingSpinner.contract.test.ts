import fs from 'fs';
import path from 'path';

describe('BrandedLoadingSpinner source contract', () => {
  it('avoids runtime font icon dependencies', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'BrandedLoadingSpinner.tsx'),
      'utf8',
    );

    expect(source).toContain("from 'react-native-svg'");
    expect(source).not.toContain('@expo/vector-icons');
    expect(source).not.toContain('Feather');
  });
});

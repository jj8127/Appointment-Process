import fs from 'fs';
import path from 'path';

describe('BrandedLoadingSpinner source contract', () => {
  it('uses the native request-board create loading animation as the shared spinner baseline', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'BrandedLoadingSpinner.tsx'),
      'utf8',
    );

    expect(source).toContain('ActivityIndicator');
    expect(source).toContain("from 'react-native'");
    expect(source).not.toContain("from 'react-native-svg'");
    expect(source).not.toContain('Animated');
    expect(source).not.toContain('Easing');
    expect(source).not.toContain('@expo/vector-icons');
    expect(source).not.toContain('Feather');
  });
});

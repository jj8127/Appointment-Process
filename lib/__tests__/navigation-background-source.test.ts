import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const layoutSource = readFileSync(
  join(__dirname, '..', '..', 'app', '_layout.tsx'),
  'utf8',
).replace(/\r\n?/g, '\n');

describe('navigation background fallbacks', () => {
  it('keeps app-level navigation surfaces on an explicit light background', () => {
    expect(layoutSource).toContain("const DEFAULT_SCREEN_BACKGROUND = '#ffffff'");
    expect(layoutSource).toContain(
      'const defaultStackScreenOptions = {\n' +
        '  headerShown: false,\n' +
        '  contentStyle: { backgroundColor: DEFAULT_SCREEN_BACKGROUND },\n' +
        '} as const;',
    );
    expect(layoutSource.match(/screenOptions=\{defaultStackScreenOptions\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(layoutSource).toContain('background: DEFAULT_SCREEN_BACKGROUND');
    expect(layoutSource).toContain('card: DEFAULT_SCREEN_BACKGROUND');
    expect(layoutSource).toContain('backgroundColor: DEFAULT_SCREEN_BACKGROUND');
    expect(layoutSource).toContain('NavigationBar.setBackgroundColorAsync(DEFAULT_SCREEN_BACKGROUND)');
    expect(layoutSource.match(/<StatusBar style="dark" backgroundColor=\{DEFAULT_SCREEN_BACKGROUND\}/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('keeps custom-header screens from inheriting a platform default scene color', () => {
    expect(layoutSource).toContain(
      'const baseHeader = {\n' +
        '  headerShown: true,\n' +
        '  header: (props: any) => <CompactHeader {...props} />,\n' +
        '  contentStyle: { backgroundColor: DEFAULT_SCREEN_BACKGROUND },\n' +
        '} as const;',
    );
    expect(layoutSource).toContain('contentStyle: { backgroundColor: AUTH_SCREEN_BACKGROUND }');
  });
});

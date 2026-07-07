import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Button source contract', () => {
  const source = readFileSync(join(process.cwd(), 'components', 'Button.tsx'), 'utf8');

  it('keeps keyboard dismissal inside the final press handler for Android form CTAs', () => {
    expect(source).toContain('dismissKeyboardOnPress?: boolean;');
    expect(source).toContain('submitOnPressIn?: boolean;');
    expect(source).toContain('dismissKeyboardOnPress = false');
    expect(source).toContain('submitOnPressIn = false');
    expect(source).toContain('const pressInHandledRef = React.useRef(false);');
    expect(source).toContain('const handlePress = () => {');
    expect(source).toContain('const handlePressIn = () => {');
    expect(source).toContain('if (!submitOnPressIn) return;');
    expect(source).toContain('pressInHandledRef.current = true;');
    expect(source).toContain('onPress?.();');
    expect(source).toContain('if (dismissKeyboardOnPress) {');
    expect(source).toContain('Keyboard.dismiss();');
    expect(source).toContain('onPress={handlePress}');
    expect(source).toContain('onPressIn={handlePressIn}');
    expect(source).toContain('if (submitOnPressIn && pressInHandledRef.current) {');
    expect(source).toContain('pressInHandledRef.current = false;');
    expect(source).not.toContain('onPressIn={dismissKeyboardOnPress ? () => Keyboard.dismiss() : undefined}');

    expect(source.indexOf('onPress?.();')).toBeLessThan(source.indexOf('Keyboard.dismiss();'));
  });
});

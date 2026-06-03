import fs from 'fs';
import path from 'path';

import { hasCallableAlertAction, resolveAlertButtonByIndex } from '../app-alert-utils';

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

  it('passes a serializable button index through runOnJS instead of a button object', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'AppAlertProvider.tsx'),
      'utf8',
    );

    expect(source).toContain('runOnJS(onButtonPress)(buttonIndex)');
    expect(source).not.toContain('runOnJS(onButtonPress)(button)');
  });

  it('resolves only valid alert button indexes', () => {
    const buttons = [
      { text: '취소', style: 'cancel' as const },
      { text: '확인', onPress: jest.fn() },
    ];

    expect(resolveAlertButtonByIndex(buttons, 1)).toBe(buttons[1]);
    expect(resolveAlertButtonByIndex(buttons, 2)).toBeUndefined();
    expect(resolveAlertButtonByIndex(buttons, -1)).toBeUndefined();
    expect(resolveAlertButtonByIndex(buttons, undefined)).toBeUndefined();
  });

  it('does not treat non-function onPress payloads as callable actions', () => {
    const callableButton = { text: '확인', onPress: jest.fn() };
    const malformedButton: { text: string; onPress: unknown } = { text: '확인', onPress: {} };

    expect(hasCallableAlertAction(callableButton)).toBe(true);
    expect(hasCallableAlertAction(malformedButton)).toBe(false);
    expect(hasCallableAlertAction(undefined)).toBe(false);
  });
});

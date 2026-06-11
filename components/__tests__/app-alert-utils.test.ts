import {
  invokeAlertButtonByIndex,
  resolveAlertButtonIndex,
} from '../app-alert-utils';

describe('app alert worklet-safe button helpers', () => {
  it('resolves a button object to a primitive index before crossing runOnJS', () => {
    const buttons = [{ text: 'Cancel' }, { text: 'Confirm', onPress: jest.fn() }];

    expect(resolveAlertButtonIndex(buttons, buttons[1])).toBe(1);
    expect(resolveAlertButtonIndex(buttons, undefined)).toBe(-1);
  });

  it('invokes only callable button handlers by primitive index and dismisses', () => {
    const onPress = jest.fn();
    const dismiss = jest.fn();
    const buttons = [
      { text: 'Cancel' },
      { text: 'Confirm', onPress },
      { text: 'Invalid', onPress: 'not-callable' },
    ];

    invokeAlertButtonByIndex(buttons, 1, dismiss);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);

    invokeAlertButtonByIndex(buttons, 2, dismiss);
    invokeAlertButtonByIndex(buttons, -1, dismiss);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(3);
  });
});

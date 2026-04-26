import { getChatTargetPickerHeaderConfig } from '@/lib/chat-navigation';

describe('chat target picker header config', () => {
  it('shows a back button and returns to the messenger hub', () => {
    expect(getChatTargetPickerHeaderConfig()).toEqual({
      title: '메신저',
      showBackButton: true,
      fallbackHref: '/messenger',
    });
  });
});

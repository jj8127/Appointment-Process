export function getChatTargetPickerHeaderConfig() {
  return {
    title: '메신저',
    showBackButton: true,
    fallbackHref: '/messenger' as const,
  };
}

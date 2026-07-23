type WarningResponse = {
  warning?: unknown;
};

export function getAdminNotificationWarning(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const warning = (response as WarningResponse).warning;
  void warning;
  return null;
}

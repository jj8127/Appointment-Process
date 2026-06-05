const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

type ManagerDeliveryInput = {
  category?: string | null;
  targetId?: string | null;
};

type TokenWithRole = {
  role?: string | null;
};

function normalizeCategory(category?: string | null): string {
  return (category ?? '').trim().toLowerCase();
}

function hasConcreteTargetId(targetId?: string | null): boolean {
  return (targetId ?? '').replace(/[^0-9]/g, '').length > 0;
}

export function isRequestBoardNotificationCategory(category?: string | null): boolean {
  return normalizeCategory(category).startsWith(REQUEST_BOARD_CATEGORY_PREFIX);
}

export function shouldDeliverToManagerMobileToken({ category, targetId }: ManagerDeliveryInput): boolean {
  const normalizedCategory = normalizeCategory(category);
  if (isRequestBoardNotificationCategory(normalizedCategory)) return true;
  return normalizedCategory === 'message' && hasConcreteTargetId(targetId);
}

export function filterManagerTokensForNotification<T extends TokenWithRole>(
  tokens: readonly T[],
  input: ManagerDeliveryInput,
): T[] {
  return tokens.filter((token) => {
    const role = (token.role ?? '').trim().toLowerCase();
    if (role !== 'manager') return true;
    return shouldDeliverToManagerMobileToken(input);
  });
}

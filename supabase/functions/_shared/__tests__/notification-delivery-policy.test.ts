import {
  filterManagerTokensForNotification,
  shouldDeliverToManagerMobileToken,
} from '../notification-delivery-policy';

const tokens = [
  { expo_push_token: 'admin-token', role: 'admin' },
  { expo_push_token: 'fc-token', role: 'fc' },
  { expo_push_token: 'manager-token', role: 'manager' },
] as const;

describe('notification delivery policy', () => {
  it('keeps manager mobile tokens only for request-board notifications', () => {
    expect(shouldDeliverToManagerMobileToken({ category: 'request_board_new_request', targetId: null })).toBe(true);
    expect(shouldDeliverToManagerMobileToken({ category: 'request_board_completed', targetId: null })).toBe(true);
  });

  it('keeps manager mobile tokens for direct internal chat only', () => {
    expect(shouldDeliverToManagerMobileToken({ category: 'message', targetId: '01012345678' })).toBe(true);
    expect(shouldDeliverToManagerMobileToken({ category: 'message', targetId: null })).toBe(false);
  });

  it('removes manager mobile tokens from board, notice, and exam broadcasts', () => {
    expect(
      filterManagerTokensForNotification(tokens, { category: 'notice', targetId: null }).map((token) => token.expo_push_token),
    ).toEqual(['admin-token', 'fc-token']);
    expect(
      filterManagerTokensForNotification(tokens, { category: 'exam_round', targetId: null }).map((token) => token.expo_push_token),
    ).toEqual(['admin-token', 'fc-token']);
  });
});

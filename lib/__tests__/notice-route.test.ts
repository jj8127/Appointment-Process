import { resolveNoticeRoute } from '../notice-route';

describe('resolveNoticeRoute', () => {
  it('routes board notices to the standalone board detail screen', () => {
    expect(resolveNoticeRoute('board_notice:post-123')).toBe('/board-detail?postId=post-123');
  });

  it('routes legacy notices to notice detail', () => {
    expect(resolveNoticeRoute('notice-123')).toBe('/notice-detail?id=notice-123');
  });
});

import { resolveHomeLatestNoticeRoute, resolveNoticeRoute } from '../notice-route';

describe('resolveNoticeRoute', () => {
  it('routes board notices to the board modal entry', () => {
    expect(resolveNoticeRoute('board_notice:post-123')).toBe('/board?postId=post-123');
  });

  it('routes legacy notices to notice detail', () => {
    expect(resolveNoticeRoute('notice-123')).toBe('/notice-detail?id=notice-123');
  });
});

describe('resolveHomeLatestNoticeRoute', () => {
  it('routes home board notices to the board modal entry', () => {
    expect(resolveHomeLatestNoticeRoute('board_notice:post-123')).toBe('/board?postId=post-123');
  });

  it('routes home board notices without a post id to the board list', () => {
    expect(resolveHomeLatestNoticeRoute('board_notice:')).toBe('/board');
  });

  it('keeps legacy notices on notice detail', () => {
    expect(resolveHomeLatestNoticeRoute('notice-123')).toBe('/notice-detail?id=notice-123');
  });
});

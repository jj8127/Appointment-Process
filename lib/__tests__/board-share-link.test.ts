import {
  buildBoardPostShareContent,
  buildBoardPostShareUrl,
  normalizeBoardPostShareId,
} from '../board-share-link';

describe('board-share-link', () => {
  it('normalizes board post ids before sharing', () => {
    expect(normalizeBoardPostShareId('  post-123  ')).toBe('post-123');
    expect(normalizeBoardPostShareId(null)).toBe('');
  });

  it('builds a clickable HTTPS board share link with postId query param', () => {
    expect(buildBoardPostShareUrl(' post-123 ')).toBe(
      'https://garam-invite.vercel.app/board?postId=post-123',
    );
  });

  it('keeps custom landing base urls for share links', () => {
    expect(buildBoardPostShareUrl('post-123', 'https://example.com/')).toBe(
      'https://example.com/board?postId=post-123',
    );
  });

  it('URL-encodes post ids for the landing page', () => {
    expect(buildBoardPostShareUrl('post 123/456')).toBe(
      'https://garam-invite.vercel.app/board?postId=post%20123%2F456',
    );
  });

  it('builds share content that includes the title and clickable HTTPS link', () => {
    expect(buildBoardPostShareContent({
      postId: 'post-123',
      title: '뇌혈관 진단비 판매 플랜',
      shareBaseUrl: 'https://example.com/',
    })).toEqual({
      title: '뇌혈관 진단비 판매 플랜',
      url: 'https://example.com/board?postId=post-123',
      message: '가람in 게시글을 확인하세요.\n뇌혈관 진단비 판매 플랜\nhttps://example.com/board?postId=post-123',
    });
  });

  it('throws when postId is missing', () => {
    expect(() => buildBoardPostShareUrl(' ')).toThrow('postId is required');
  });
});

import { invokeFcNotify } from '../fc-notify-client';
import { fetchAuthorizedNoticeDetail } from '../notice-detail-api';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
}));

const noticeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const target = { version: 1, kind: 'notice', noticeId } as const;

describe('exact authenticated notice detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens an exact old notice independently of list rank or list limits', async () => {
    const newerListFixture = Array.from({ length: 201 }, (_, index) => ({
      id: `newer-${index}`,
    }));
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        authorized: true,
        notice: {
          id: noticeId,
          title: 'old exact notice',
          body: 'body',
          category: '공지',
          created_at: '2026-01-01T00:00:00.000Z',
          images: [],
          files: [],
          target,
        },
        notices: newerListFixture,
      },
      error: null,
    });

    await expect(fetchAuthorizedNoticeDetail(noticeId)).resolves.toMatchObject({
      id: noticeId,
      title: 'old exact notice',
    });
    expect(invokeFcNotify).toHaveBeenCalledWith({
      type: 'notice_get',
      notice_id: noticeId,
    });
  });

  it('fails closed for unauthorized or target-mismatched responses', async () => {
    (invokeFcNotify as jest.Mock).mockResolvedValueOnce({
      data: {
        ok: true,
        authorized: false,
        notice: null,
      },
      error: null,
    });
    await expect(fetchAuthorizedNoticeDetail(noticeId)).rejects.toThrow();

    (invokeFcNotify as jest.Mock).mockResolvedValueOnce({
      data: {
        ok: true,
        authorized: true,
        notice: {
          id: noticeId,
          title: 'notice',
          body: 'body',
          target: {
            ...target,
            noticeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        },
      },
      error: null,
    });
    await expect(fetchAuthorizedNoticeDetail(noticeId)).resolves.toBeNull();
  });
});

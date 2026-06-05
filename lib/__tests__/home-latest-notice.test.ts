import { formatLatestNoticeLabel } from '../home-latest-notice';

describe('formatLatestNoticeLabel', () => {
  it('uses insurance category label for insurance news posts', () => {
    expect(formatLatestNoticeLabel({
      title: '보험소식 브리핑 2026.05.17',
      category: '보험소식',
    })).toBe('보험소식: 보험소식 브리핑 2026.05.17');
  });

  it('uses GaramPick category label for GaramPick board posts', () => {
    expect(formatLatestNoticeLabel({
      title: '뇌혈관 진단비 판매 플랜(26.06.05)',
      category: '가람 Pick',
    })).toBe('가람pick: 뇌혈관 진단비 판매 플랜(26.06.05)');
  });

  it('falls back to notice label for regular notices', () => {
    expect(formatLatestNoticeLabel({
      title: '서류 제출 안내',
      category: '공지사항',
    })).toBe('공지: 서류 제출 안내');
  });

  it('returns default copy without a title', () => {
    expect(formatLatestNoticeLabel(null)).toBe('게시판: 최신 게시글을 확인하세요');
  });
});

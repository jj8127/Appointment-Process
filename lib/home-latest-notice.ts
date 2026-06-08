const DEFAULT_LATEST_NOTICE_LABEL = '게시판: 최신 게시글을 확인하세요';

export type LatestNoticeLabelInput = {
  title?: string | null;
  category?: string | null;
};

export function formatLatestNoticeLabel(notice?: LatestNoticeLabelInput | null): string {
  const title = String(notice?.title ?? '').trim();
  if (!title) return DEFAULT_LATEST_NOTICE_LABEL;

  const category = String(notice?.category ?? '').trim();
  const normalizedCategory = category.replace(/\s+/g, '').toLowerCase();
  const prefix = normalizedCategory.includes('상품추천') || normalizedCategory.includes('가람pick')
    ? '상품추천'
    : normalizedCategory.includes('시책')
      ? '시책'
    : category.includes('보험')
      ? '보험소식'
      : '공지';
  return `${prefix}: ${title}`;
}

const DEFAULT_LATEST_NOTICE_LABEL = '공지: 최신 공지사항을 확인하세요';

export type LatestNoticeLabelInput = {
  title?: string | null;
  category?: string | null;
};

export function formatLatestNoticeLabel(notice?: LatestNoticeLabelInput | null): string {
  const title = String(notice?.title ?? '').trim();
  if (!title) return DEFAULT_LATEST_NOTICE_LABEL;

  const category = String(notice?.category ?? '').trim();
  const prefix = category.includes('보험') ? '보험소식' : '공지';
  return `${prefix}: ${title}`;
}

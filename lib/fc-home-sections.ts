/**
 * Pure helpers for the redesigned FC home sections (progress, exam rounds, news, shortcuts).
 * Motion durations were confirmed by the user in the 2026-10-16 home prototype (2x speed).
 */

export const FC_HOME_MOTION = {
  press: 380,
  checkDraw: 1220,
  checkDelay: 260,
  donePop: 1020,
  progressFill: 1480,
  progressFillDelay: 380,
  contentSwap: 760,
  cardSettle: 1080,
  chipIndicator: 900,
  chipText: 700,
  indicatorDot: 840,
} as const;

/** Subtitles of the next-step card that mean "someone else acts next". */
export function isFcHomeNextActionWaiting(subtitle: string | null | undefined) {
  return /기다|준비 중|발급중|검토 중|심사/.test(subtitle ?? '');
}

/** Steps that turned "done" since the last time this FC saw the home screen. */
export function getNewlyCompletedSteps(lastSeenStep: number | null, currentStep: number) {
  if (lastSeenStep === null || !Number.isFinite(lastSeenStep) || currentStep <= lastSeenStep) return [];
  const steps: number[] = [];
  for (let step = Math.max(1, lastSeenStep); step < currentStep; step += 1) steps.push(step);
  return steps;
}

export type HomeExamRound = {
  examType: 'life' | 'nonlife';
  /** exam_date can be empty in production rounds. */
  examDate: string | null;
  registrationDeadline: string;
  roundLabel: string | null;
};

const toKstYmd = (now: Date) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** Days until a YYYY-MM-DD deadline in Asia/Seoul; the deadline day itself is D-0. */
export function getKstDaysUntil(ymd: string, now = new Date()) {
  const today = Date.parse(`${toKstYmd(now)}T00:00:00Z`);
  const target = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  return Math.round((target - today) / 86_400_000);
}

/** M.D for a YYYY-MM-DD value; empty or malformed dates become null. */
export function formatHomeMonthDay(ymd: string | null | undefined) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

export function formatDday(days: number | null) {
  if (days === null) return '';
  return days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}`;
}

/** The nearest still-open round per exam type, life first. Types without an open round are reported as null. */
export function pickHomeExamRounds(rounds: HomeExamRound[], now = new Date()) {
  const open = rounds
    .filter((round) => {
      const days = getKstDaysUntil(round.registrationDeadline, now);
      return days !== null && days >= 0;
    })
    .sort((a, b) => a.registrationDeadline.localeCompare(b.registrationDeadline));
  return (['life', 'nonlife'] as const).map((examType) => ({
    examType,
    round: open.find((round) => round.examType === examType) ?? null,
  }));
}

/** Short Korean relative time for home lists: 방금, N분 전, N시간 전, 어제, M.D */
export function formatHomeRelativeTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const days = getKstDaysUntil(toKstYmd(now), new Date(time));
  if (days === 0) return `${Math.floor(minutes / 60)}시간 전`;
  if (days === 1) return '어제';
  const [, month, day] = toKstYmd(new Date(time)).split('-');
  return `${Number(month)}.${Number(day)}`;
}

/** What the home allowance card shows: always an amount, like the prototype, with the month it belongs to. */
export function getHomeAllowanceDisplay(input: {
  statement: { performanceMonth: string; summary: { newPaymentKrw: number } } | null | undefined;
  loading: boolean;
  /** Any error from the allowance read; a non-recipient's 403 means nothing was paid, not a failure. */
  error: unknown;
}) {
  if (input.statement) {
    const [year, month] = input.statement.performanceMonth.split('-');
    return {
      value: `${input.statement.summary.newPaymentKrw.toLocaleString('ko-KR')}원`,
      caption: `${year}년 ${Number(month)}월 실적`,
    };
  }
  if (input.loading) return { value: ' ', caption: ' ' };
  const error = input.error as { status?: number; code?: string } | null | undefined;
  const notRecipient = error?.status === 403 || error?.code === 'forbidden';
  if (error && !notRecipient) return { value: '확인 필요', caption: '다시 불러와 주세요' };
  return { value: '0원', caption: '지급 내역 없음' };
}

export type HomeTagTone = { background: string; color: string };

const TAG_TONES = {
  orange: { background: '#fff1e6', color: '#a8460f' },
  blue: { background: '#e8f0fc', color: '#2f5f9e' },
  teal: { background: '#e3f4f1', color: '#1f6f66' },
  amber: { background: '#fff4dc', color: '#8a5a00' },
  indigo: { background: '#eeecfb', color: '#4f46a5' },
  gray: { background: '#eceef1', color: '#374151' },
} satisfies Record<string, HomeTagTone>;

const TAG_TONE_RULES: [RegExp, HomeTagTone][] = [
  [/공지|필독/, TAG_TONES.orange],
  [/교육|일정/, TAG_TONES.blue],
  [/상품|추천/, TAG_TONES.teal],
  [/시책|이벤트|프로모션|혜택/, TAG_TONES.amber],
  [/소식|뉴스|원수사/, TAG_TONES.indigo],
  [/일반|자유|기타/, TAG_TONES.gray],
];
const FALLBACK_TONES = [TAG_TONES.blue, TAG_TONES.teal, TAG_TONES.amber, TAG_TONES.indigo];

/** One stable tint per board category so post kinds are told apart at a glance; labels stay as text. */
export function getHomeCategoryTone(name: string | null | undefined): HomeTagTone {
  const label = (name ?? '').trim();
  if (!label) return TAG_TONES.gray;
  const rule = TAG_TONE_RULES.find(([pattern]) => pattern.test(label));
  if (rule) return rule[1];
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_TONES[hash % FALLBACK_TONES.length];
}

/** Posts from the last 7 days count as new on the home. */
export function isRecentHomePost(iso: string | null | undefined, now = new Date()) {
  const time = Date.parse(iso ?? '');
  return !Number.isNaN(time) && now.getTime() - time <= 7 * 86_400_000;
}

type HomeBoardPost = { isPinned: boolean; isRead?: boolean; createdAt: string };

/** Unread by the viewer's read state; before the list reports it, fall back to "posted this week". */
export function isUnreadHomePost(post: HomeBoardPost, now = new Date()) {
  return post.isRead === undefined ? isRecentHomePost(post.createdAt, now) : !post.isRead;
}

/**
 * Home preview order: unread must-read, then other unread posts, then the rest, each in the board's order.
 * Without reported read state nothing is reordered, so pinned posts still lead as before.
 */
export function rankHomeBoardPosts<T extends HomeBoardPost>(posts: T[]): T[] {
  const rank = (post: T) => (post.isRead !== false ? 2 : post.isPinned ? 0 : 1);
  return posts.map((post, index) => ({ post, index }))
    .sort((a, b) => rank(a.post) - rank(b.post) || a.index - b.index)
    .map(({ post }) => post);
}

export type FcHomeShortcutIcon =
  | 'profile'
  | 'documents'
  | 'link'
  | 'life'
  | 'nonlife'
  | 'consent'
  | 'appointment'
  | 'referral'
  | 'allowance'
  | 'howto';

const SHORTCUT_ICON_BY_HREF: Record<string, FcHomeShortcutIcon> = {
  '/fc/new': 'profile',
  '/signup': 'profile',
  '/docs-upload': 'documents',
  '/hanwha-commission': 'link',
  '/exam-apply': 'life',
  '/exam-apply2': 'nonlife',
  '/consent': 'consent',
  '/appointment': 'appointment',
  '/referral': 'referral',
  '/referral-allowance': 'allowance',
};

export function getFcHomeShortcutIcon(href: string): FcHomeShortcutIcon | null {
  return SHORTCUT_ICON_BY_HREF[href] ?? null;
}

/** Shortened labels for the 4-column icon grid; the full title stays the accessibility label. */
const SHORTCUT_SHORT_LABELS: Record<string, string> = {
  '/exam-apply': '생명 시험',
  '/exam-apply2': '손해 시험',
  '/consent': '보증 보험',
  '/docs-upload': '서류 제출',
  '/appointment': '위촉',
};

export function getFcHomeShortcutLabel(href: string, title: string) {
  return SHORTCUT_SHORT_LABELS[href] ?? title;
}

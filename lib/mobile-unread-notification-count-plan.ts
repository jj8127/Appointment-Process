export type MobileUnreadRole = 'admin' | 'fc' | null;
export type MobileUnreadRequestBoardRole = 'fc' | 'designer' | null;

export type MobileUnreadNotificationCountOptions = {
  role: MobileUnreadRole;
  residentId?: string | null;
  requestBoardRole?: MobileUnreadRequestBoardRole;
  noticeSince?: string | null;
};

type ResolveMobileUnreadBridgePlanOptions = {
  role: MobileUnreadRole;
  requestBoardRole?: MobileUnreadRequestBoardRole;
};

type MobileUnreadBridgePlan = {
  shouldFetch: boolean;
  includeLiveRequestBoardUnread: boolean;
  includeRequestBoardFcInbox: boolean;
  includeNoticeUnread: boolean;
  onlyRequestBoardCategories: boolean;
};

export const resolveMobileUnreadBridgePlan = ({
  role,
  requestBoardRole = null,
}: ResolveMobileUnreadBridgePlanOptions): MobileUnreadBridgePlan => {
  const shouldFetch = role !== null;
  const isRequestBoardDesigner = requestBoardRole === 'designer';
  return {
    shouldFetch,
    includeLiveRequestBoardUnread: false,
    includeRequestBoardFcInbox: shouldFetch && role === 'admin' && requestBoardRole !== null,
    includeNoticeUnread: shouldFetch && !isRequestBoardDesigner,
    onlyRequestBoardCategories: shouldFetch && isRequestBoardDesigner,
  };
};

type BuildMobileUnreadFcNotifyBodyOptions = {
  role: Exclude<MobileUnreadRole, null>;
  residentId?: string | null;
  includeLiveRequestBoardUnread: boolean;
  includeRequestBoardFcInbox: boolean;
  includeNoticeUnread: boolean;
  onlyRequestBoardCategories: boolean;
  noticeSince?: string | null;
};

export const buildMobileUnreadFcNotifyBody = ({
  role,
  residentId,
  includeLiveRequestBoardUnread,
  includeRequestBoardFcInbox,
  includeNoticeUnread,
  onlyRequestBoardCategories,
  noticeSince = null,
}: BuildMobileUnreadFcNotifyBodyOptions) => ({
  type: 'inbox_unread_count',
  role,
  resident_id: residentId ?? null,
  exclude_request_board_categories: includeLiveRequestBoardUnread,
  include_request_board_fc: includeRequestBoardFcInbox,
  include_notices: includeNoticeUnread,
  only_request_board_categories: onlyRequestBoardCategories,
  ...(includeNoticeUnread && noticeSince ? { notice_since: noticeSince } : {}),
});

type CombineMobileUnreadCountsOptions = {
  fcNotifyCount: unknown;
  requestBoardUnreadCount: number;
  includeLiveRequestBoardUnread: boolean;
};

export const combineMobileUnreadCounts = ({
  fcNotifyCount,
  requestBoardUnreadCount,
  includeLiveRequestBoardUnread,
}: CombineMobileUnreadCountsOptions): number => {
  const total = Number(fcNotifyCount ?? 0);
  return includeLiveRequestBoardUnread ? total + requestBoardUnreadCount : total;
};

type MobileUnreadFcNotifyResult = {
  data?: {
    ok?: boolean;
    count?: unknown;
    message?: string;
  } | null;
  error?: unknown;
};

type MobileUnreadOrchestrationDeps = {
  invokeFcNotify: (
    body: ReturnType<typeof buildMobileUnreadFcNotifyBody>,
  ) => Promise<MobileUnreadFcNotifyResult>;
  getRequestBoardUnreadCount: () => Promise<number>;
  warn: (message: string, error: unknown) => void;
};

export const fetchMobileUnreadNotificationCountWithDepsOrThrow = async ({
  role,
  residentId,
  requestBoardRole = null,
  noticeSince = null,
}: MobileUnreadNotificationCountOptions, deps: MobileUnreadOrchestrationDeps): Promise<number> => {
  const bridgePlan = resolveMobileUnreadBridgePlan({ role, requestBoardRole });
  if (!bridgePlan.shouldFetch || role === null) return 0;

  const { data, error } = await deps.invokeFcNotify(
    buildMobileUnreadFcNotifyBody({
      role,
      residentId,
      includeLiveRequestBoardUnread: bridgePlan.includeLiveRequestBoardUnread,
      includeRequestBoardFcInbox: bridgePlan.includeRequestBoardFcInbox,
      includeNoticeUnread: bridgePlan.includeNoticeUnread,
      onlyRequestBoardCategories: bridgePlan.onlyRequestBoardCategories,
      noticeSince,
    }),
  );

  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message ?? '알림 개수 조회 실패');

  return combineMobileUnreadCounts({
    fcNotifyCount: data.count,
    requestBoardUnreadCount: bridgePlan.includeLiveRequestBoardUnread
      ? await deps.getRequestBoardUnreadCount()
      : 0,
    includeLiveRequestBoardUnread: bridgePlan.includeLiveRequestBoardUnread,
  });
};

export const fetchMobileUnreadNotificationCountWithDeps = async (
  options: MobileUnreadNotificationCountOptions,
  deps: MobileUnreadOrchestrationDeps,
): Promise<number> => {
  try {
    return await fetchMobileUnreadNotificationCountWithDepsOrThrow(options, deps);
  } catch (err) {
    deps.warn('[mobile-unread-count] fetch failed', err);
    return 0;
  }
};

export type MobileUnreadRole = 'admin' | 'fc' | null;
export type MobileUnreadRequestBoardRole = 'fc' | 'designer' | null;

export type MobileUnreadNotificationCountOptions = {
  role: MobileUnreadRole;
  residentId?: string | null;
  requestBoardRole?: MobileUnreadRequestBoardRole;
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
  sinceIso: string;
  includeLiveRequestBoardUnread: boolean;
  includeRequestBoardFcInbox: boolean;
  includeNoticeUnread: boolean;
  onlyRequestBoardCategories: boolean;
};

export const buildMobileUnreadFcNotifyBody = ({
  role,
  residentId,
  sinceIso,
  includeLiveRequestBoardUnread,
  includeRequestBoardFcInbox,
  includeNoticeUnread,
  onlyRequestBoardCategories,
}: BuildMobileUnreadFcNotifyBodyOptions) => ({
  type: 'inbox_unread_count',
  role,
  resident_id: residentId ?? null,
  since: sinceIso,
  exclude_request_board_categories: includeLiveRequestBoardUnread,
  include_request_board_fc: includeRequestBoardFcInbox,
  include_notices: includeNoticeUnread,
  only_request_board_categories: onlyRequestBoardCategories,
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
  getNotificationCheckpoint: (
    scope: MobileUnreadNotificationCountOptions,
    options: { initializeIfMissing: false },
  ) => Promise<Date>;
  invokeFcNotify: (
    body: ReturnType<typeof buildMobileUnreadFcNotifyBody>,
  ) => Promise<MobileUnreadFcNotifyResult>;
  getRequestBoardUnreadCount: () => Promise<number>;
  warn: (message: string, error: unknown) => void;
};

export const fetchMobileUnreadNotificationCountWithDeps = async ({
  role,
  residentId,
  requestBoardRole = null,
}: MobileUnreadNotificationCountOptions, deps: MobileUnreadOrchestrationDeps): Promise<number> => {
  const bridgePlan = resolveMobileUnreadBridgePlan({ role, requestBoardRole });
  if (!bridgePlan.shouldFetch || role === null) return 0;

  try {
    const lastCheckDate = await deps.getNotificationCheckpoint({
      role,
      residentId,
      requestBoardRole,
    }, { initializeIfMissing: false });

    const { data, error } = await deps.invokeFcNotify(
      buildMobileUnreadFcNotifyBody({
        role,
        residentId,
        sinceIso: lastCheckDate.toISOString(),
        includeLiveRequestBoardUnread: bridgePlan.includeLiveRequestBoardUnread,
        includeRequestBoardFcInbox: bridgePlan.includeRequestBoardFcInbox,
        includeNoticeUnread: bridgePlan.includeNoticeUnread,
        onlyRequestBoardCategories: bridgePlan.onlyRequestBoardCategories,
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
  } catch (err) {
    deps.warn('[mobile-unread-count] fetch failed', err);
    return 0;
  }
};

import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  GestureResponderEvent,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RefreshButton } from '@/components/RefreshButton';
import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import { fetchMobileUnreadNotificationCount } from '@/lib/mobile-unread-notification-count';
import { setNotificationCheckpointNow } from '@/lib/notification-checkpoint';
import { resolveNoticeRoute } from '@/lib/notice-route';
import { supabase } from '@/lib/supabase';
import { syncNativeNotificationBadge } from '@/lib/system-notification-badge';
import { COLORS } from '@/lib/theme';

type Notice = {
  id: string;
  rawId: string;
  title: string;
  body: string;
  category?: string | null;
  targetUrl?: string | null;
  created_at?: string | null;
  source: 'notification' | 'notice';
  origin: 'request_board' | 'fc_onboarding' | 'notice';
};

type InboxNotificationPayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  target_url?: string | null;
  created_at?: string | null;
};

type InboxNoticePayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at?: string | null;
};

type InboxListResponse = {
  ok?: boolean;
  message?: string;
  notifications?: InboxNotificationPayload[];
  notices?: InboxNoticePayload[];
};

const HIDDEN_NOTICE_KEY_PREFIX = 'hiddenNoticeIds';
const LIST_CONTENT_PADDING_TOP = 20;
const ITEM_BOTTOM_GAP = 12;
const FALLBACK_ITEM_HEIGHT = 104;
const AUTO_SCROLL_EDGE_THRESHOLD = 72;
const AUTO_SCROLL_MAX_STEP = 18;
const AUTO_SCROLL_INTERVAL_MS = 32;
const REQUEST_BOARD_CATEGORY_PREFIX = 'request_board_';

const REQUEST_BOARD_CATEGORY_LABELS: Record<string, string> = {
  request_board_new_request: '의뢰 도착',
  request_board_accepted: '의뢰 수락',
  request_board_rejected: '의뢰 거절',
  request_board_completed: '설계 완료',
  request_board_cancelled: '의뢰 취소',
  'request_board_fc-accepted': 'FC 승인',
  'request_board_fc-rejected': 'FC 거절',
  request_board_message: '새 메시지',
  request_board_bridge_test: '연동 테스트',
};

const isRequestBoardCategory = (category?: string | null): boolean =>
  (category ?? '').trim().toLowerCase().startsWith(REQUEST_BOARD_CATEGORY_PREFIX);

export default function NotificationsScreen() {
  const router = useRouter();
  const { role, residentId, hydrated, isRequestBoardDesigner, requestBoardRole } = useSession();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const inboxRole: 'admin' | 'fc' | null = role;
  const inboxResidentId = residentId || null;
  const includeRequestBoardFcInbox = inboxRole === 'admin' && requestBoardRole === 'fc';
  const hiddenNoticeStorageKey =
    inboxRole === 'fc' ? `${HIDDEN_NOTICE_KEY_PREFIX}:${residentId || 'fc'}` : null;

  const selectionModeRef = useRef(selectionMode);
  const isDraggingRef = useRef(isDragging);
  const selectedIdsRef = useRef(selectedIds);
  const selectedCountRef = useRef(0);
  const dragSelectArmedRef = useRef(false);
  const lastDragSelectedIdRef = useRef<string | null>(null);
  const ignoreNextPressIdRef = useRef<string | null>(null);
  const listTopRef = useRef(0);
  const dragListTopRef = useRef(0);
  const listContainerRef = useRef<View | null>(null);
  const flatListRef = useRef<FlatList<Notice> | null>(null);
  const listContainerHeightRef = useRef(0);
  const listContentHeightRef = useRef(0);
  const dragPointerPageYRef = useRef<number | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const itemHeightsRef = useRef<Map<string, number>>(new Map());
  const itemLayoutsRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    selectedCountRef.current = selectedIds.size;
  }, [selectedIds]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    dragPointerPageYRef.current = null;
  }, []);

  const clearAlertTimer = useCallback(() => {
    if (alertTimerRef.current) {
      clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
  }, []);

  const recomputeItemLayouts = useCallback(() => {
    const nextLayouts = new Map<string, { y: number; height: number }>();
    let cursor = LIST_CONTENT_PADDING_TOP;
    for (const notice of notices) {
      const height = itemHeightsRef.current.get(notice.id) ?? FALLBACK_ITEM_HEIGHT;
      nextLayouts.set(notice.id, { y: cursor, height });
      cursor += height + ITEM_BOTTOM_GAP;
    }
    itemLayoutsRef.current = nextLayouts;
  }, [notices]);

  useEffect(() => {
    recomputeItemLayouts();
  }, [recomputeItemLayouts]);

  useEffect(() => {
    if (selectionMode && selectedIds.size === 0) {
      setSelectionMode(false);
    }
  }, [selectionMode, selectedIds.size]);

  const endDragSelection = useCallback(() => {
    setDragArmed(false);
    dragSelectArmedRef.current = false;
    lastDragSelectedIdRef.current = null;
    dragListTopRef.current = 0;
    stopAutoScroll();
    setIsDragging(false);
  }, [stopAutoScroll]);

  useEffect(() => {
    if (!selectionMode) {
      endDragSelection();
      ignoreNextPressIdRef.current = null;
    }
  }, [endDragSelection, selectionMode]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearAlertTimer();
      stopAutoScroll();
    };
  }, [clearAlertTimer, stopAutoScroll]);

  const findItemAtAbsoluteY = useCallback((pageY: number): string | null => {
    const topBase = dragSelectArmedRef.current ? dragListTopRef.current : listTopRef.current;
    const contentY = pageY - topBase + scrollOffsetRef.current;
    for (const [id, layout] of itemLayoutsRef.current) {
      if (contentY >= layout.y && contentY <= layout.y + layout.height + 14) {
        return id;
      }
    }
    return null;
  }, []);

  const selectByContainerY = useCallback(
    (pageY: number) => {
      const hitId = findItemAtAbsoluteY(pageY);
      if (!hitId || hitId === lastDragSelectedIdRef.current) return;

      lastDragSelectedIdRef.current = hitId;

      let changed = false;
      setSelectedIds((prev) => {
        const has = prev.has(hitId);
        const next = new Set(prev);
        if (has) {
          next.delete(hitId);
        } else {
          next.add(hitId);
        }
        selectedIdsRef.current = next;
        selectedCountRef.current = next.size;
        changed = true;
        return next;
      });
      if (changed) {
        void Haptics.selectionAsync();
      }
    },
    [findItemAtAbsoluteY],
  );

  const stepAutoScroll = useCallback(() => {
    if (!dragSelectArmedRef.current) {
      stopAutoScroll();
      return;
    }

    const pointerPageY = dragPointerPageYRef.current;
    if (pointerPageY == null) {
      stopAutoScroll();
      return;
    }

    const containerHeight = listContainerHeightRef.current;
    const contentHeight = listContentHeightRef.current;
    if (containerHeight <= 0 || contentHeight <= containerHeight) {
      stopAutoScroll();
      return;
    }

    const topBase = dragSelectArmedRef.current ? dragListTopRef.current : listTopRef.current;
    const localY = pointerPageY - topBase;
    const edge = Math.min(AUTO_SCROLL_EDGE_THRESHOLD, containerHeight / 2);

    let step = 0;
    if (localY < edge) {
      const intensity = Math.min(1, (edge - localY) / edge);
      step = -Math.max(2, Math.round(AUTO_SCROLL_MAX_STEP * intensity));
    } else if (localY > containerHeight - edge) {
      const intensity = Math.min(1, (localY - (containerHeight - edge)) / edge);
      step = Math.max(2, Math.round(AUTO_SCROLL_MAX_STEP * intensity));
    }

    if (step === 0) {
      stopAutoScroll();
      return;
    }

    const maxOffset = Math.max(0, contentHeight - containerHeight);
    const nextOffset = Math.min(maxOffset, Math.max(0, scrollOffsetRef.current + step));
    if (nextOffset === scrollOffsetRef.current) {
      stopAutoScroll();
      return;
    }

    flatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
    scrollOffsetRef.current = nextOffset;
    selectByContainerY(pointerPageY);
  }, [selectByContainerY, stopAutoScroll]);

  const ensureAutoScrollLoop = useCallback(() => {
    if (autoScrollTimerRef.current) return;
    autoScrollTimerRef.current = setInterval(() => {
      stepAutoScroll();
    }, AUTO_SCROLL_INTERVAL_MS);
  }, [stepAutoScroll]);

  const updateDragPointer = useCallback(
    (pageY: number) => {
      dragPointerPageYRef.current = pageY;
      ensureAutoScrollLoop();
    },
    [ensureAutoScrollLoop],
  );

  const loadHiddenNoticeIds = useCallback(async (): Promise<Set<string>> => {
    if (!hiddenNoticeStorageKey) return new Set();
    try {
      const raw = await AsyncStorage.getItem(hiddenNoticeStorageKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
    } catch (err) {
      logger.warn('Failed to load hidden notice ids', err);
      return new Set();
    }
  }, [hiddenNoticeStorageKey]);

  const saveHiddenNoticeIds = useCallback(
    async (ids: Set<string>) => {
      if (!hiddenNoticeStorageKey) return;
      try {
        await AsyncStorage.setItem(hiddenNoticeStorageKey, JSON.stringify(Array.from(ids)));
      } catch (err) {
        logger.warn('Failed to save hidden notice ids', err);
      }
    },
    [hiddenNoticeStorageKey],
  );

  const fetchInbox = useCallback(async (): Promise<{ pushRows: Notice[]; noticeRows: Notice[] }> => {
    if (!inboxRole) return { pushRows: [], noticeRows: [] };

    const { data, error } = await supabase.functions.invoke<InboxListResponse>('fc-notify', {
      body: {
        type: 'inbox_list',
        role: inboxRole,
        resident_id: inboxResidentId,
        limit: 100,
        include_request_board_fc: includeRequestBoardFcInbox,
      },
    });
    if (error) throw error;
    if (!data?.ok) {
      throw new Error(data?.message ?? '알림을 불러오지 못했습니다.');
    }

    const pushRows: Notice[] = (data.notifications ?? []).map((item) => ({
      id: `notification:${item.id}`,
      rawId: item.id,
      title: item.title,
      body: item.body,
      category: item.category ?? '알림',
      targetUrl: item.target_url ?? null,
      created_at: item.created_at,
      source: 'notification',
      origin: isRequestBoardCategory(item.category) ? 'request_board' : 'fc_onboarding',
    }));

    const noticeRows: Notice[] = (data.notices ?? []).map((item) => ({
      id: `notice:${item.id}`,
      rawId: item.id,
      title: item.title,
      body: item.body,
      category: item.category ?? '공지',
      targetUrl: null,
      created_at: item.created_at,
      source: 'notice',
      origin: 'notice',
    }));

    if (!isRequestBoardDesigner) {
      return { pushRows, noticeRows };
    }

    return {
      pushRows: Array.from(
        pushRows
          .filter((item) => item.origin === 'request_board')
          .reduce((map, item) => {
            if (!map.has(item.id)) map.set(item.id, item);
            return map;
          }, new Map<string, Notice>())
          .values(),
      ),
      noticeRows: [],
    };
  }, [includeRequestBoardFcInbox, inboxResidentId, inboxRole, isRequestBoardDesigner]);

  const load = useCallback(async () => {
    if (!hydrated) return;
    try {
      const { pushRows, noticeRows } = await fetchInbox();
      const hiddenNoticeIds = await loadHiddenNoticeIds();
      const merged = [...pushRows, ...noticeRows]
        .filter((item) => {
          if (item.source !== 'notice') return true;
          const rawNoticeId = item.id.replace('notice:', '');
          return !hiddenNoticeIds.has(rawNoticeId);
        })
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        });
        if (!mountedRef.current) return;
        setNotices(merged);
        await setNotificationCheckpointNow({
          role: inboxRole,
          residentId: inboxResidentId,
          requestBoardRole,
        });
        const unreadCount = await fetchMobileUnreadNotificationCount({
          role: inboxRole,
          residentId: inboxResidentId,
          requestBoardRole,
        });
        await syncNativeNotificationBadge(unreadCount, {
          context: 'notifications-screen-load',
          dismissPresentedWhenZero: true,
        });
    } catch (err: unknown) {
      logger.warn('Failed to load notifications', err);
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
    }, [fetchInbox, hydrated, inboxResidentId, inboxRole, loadHiddenNoticeIds, requestBoardRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleLongPressItem = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    if (!selectionModeRef.current) {
      setSelectionMode(true);
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      selectedIdsRef.current = next;
      selectedCountRef.current = next.size;
      return next;
    });

    ignoreNextPressIdRef.current = id;
    setDragArmed(true);
    dragSelectArmedRef.current = true;
    dragListTopRef.current = listTopRef.current;
    lastDragSelectedIdRef.current = id;
    setIsDragging(false);
  }, []);

  const handlePressMoveItem = useCallback(
    (event: GestureResponderEvent) => {
      if (!dragSelectArmedRef.current) return;
      if (!isDraggingRef.current) {
        setIsDragging(true);
      }
      updateDragPointer(event.nativeEvent.pageY);
      selectByContainerY(event.nativeEvent.pageY);
    },
    [selectByContainerY, updateDragPointer],
  );

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleSelectAll = () => {
    if (!notices.length) return;
    setSelectionMode(true);
    setSelectedIds(new Set(notices.map((n) => n.id)));
  };

  const handleDeleteSelected = () => {
    const selectedSnapshot = Array.from(selectedIdsRef.current);
    if (!selectedSnapshot.length) return;
    Alert.alert('알림 삭제', `선택한 ${selectedSnapshot.length}개를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void doDelete(selectedSnapshot);
        },
      },
    ]);
  };

  const doDelete = async (selectedSnapshot: string[]) => {
    try {
      if (!inboxRole) {
        throw new Error('로그인 정보를 확인할 수 없습니다.');
      }

      clearAlertTimer();
      endDragSelection();

      const selectedSet = new Set(selectedSnapshot);
      const selectedItems = notices.filter((item) => selectedSet.has(item.id));
      const notificationIds = selectedItems
        .filter((item) => item.source === 'notification')
        .map((item) => item.rawId);
      const noticeIds = selectedSnapshot
        .filter((id) => id.startsWith('notice:'))
        .map((id) => id.replace('notice:', ''));

      if (notificationIds.length > 0 || (inboxRole === 'admin' && noticeIds.length > 0)) {
        const { data, error } = await supabase.functions.invoke('fc-notify', {
          body: {
            type: 'inbox_delete',
            role: inboxRole,
            resident_id: inboxResidentId,
            notification_ids: notificationIds,
            notice_ids: inboxRole === 'admin' ? noticeIds : [],
            include_request_board_fc: includeRequestBoardFcInbox,
          },
        });
        if (error) throw error;
        if (!data?.ok) {
          throw new Error(
            typeof data?.message === 'string' ? data.message : '삭제 중 문제가 발생했습니다.',
          );
        }
      }

      if (inboxRole === 'fc' && noticeIds.length > 0) {
        const hidden = await loadHiddenNoticeIds();
        noticeIds.forEach((id) => hidden.add(id));
        await saveHiddenNoticeIds(hidden);
      }

      if (!mountedRef.current) return;
      setNotices((prev) => prev.filter((item) => !selectedSet.has(item.id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
      void load();

      const totalNotifIds = notificationIds.length;
      const isNoticeOnlyFc = inboxRole === 'fc' && noticeIds.length > 0 && totalNotifIds === 0;
      alertTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        Alert.alert(
          '완료',
          isNoticeOnlyFc
            ? '선택한 공지는 알림센터에서 숨김 처리되었습니다.'
            : '선택한 항목을 삭제했습니다.',
        );
      }, 150);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '삭제 중 문제가 발생했습니다.';
      alertTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        Alert.alert('오류', message);
      }, 150);
    }
  };

  const normalizeTargetUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return '/notifications';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const match = trimmed.match(/^https?:\/\/[^/]+(\/.*)?$/i);
      return normalizeTargetUrl(match?.[1] ?? '/notifications');
    }

    if (trimmed.startsWith('/dashboard/notifications')) return '/notice';
    if (trimmed.startsWith('/dashboard/chat')) return '/messenger?channel=garam';
    if (trimmed === '/admin-messenger') return '/messenger?channel=garam';
    if (trimmed === '/chat') return '/messenger?channel=garam';
    if (trimmed === '/request-board-messenger') return '/messenger?channel=request-board';
    if (trimmed.startsWith('/board?')) return trimmed.replace('/board?', '/board-detail?');
    if (trimmed.startsWith('/exam/apply2')) return '/exam-apply2';
    if (trimmed.startsWith('/exam/apply')) return '/exam-apply';
    if (trimmed.startsWith('/dashboard')) return '/dashboard';
    return trimmed;
  };

  const getOriginLabel = (item: Notice): string => {
    if (item.origin === 'request_board') return '설계요청';
    return '온보딩앱';
  };

  const getCategoryLabel = (item: Notice): string => {
    if (item.source === 'notice') return '공지';

    const rawCategory = (item.category ?? '').trim();
    if (!rawCategory) return '알림';

    const normalized = rawCategory.toLowerCase();
    if (normalized === 'app_event') return '앱 알림';

    if (item.origin === 'request_board') {
      return REQUEST_BOARD_CATEGORY_LABELS[normalized] ?? '설계요청 알림';
    }

    return rawCategory;
  };

  const resolveNotificationRoute = (item: Notice): string | null => {
    if (item.source === 'notice') {
      return resolveNoticeRoute(item.rawId);
    }

    if (item.origin === 'request_board') {
      const category = (item.category ?? '').trim().toLowerCase();
      if (category === 'request_board_message') {
        return '/messenger?channel=request-board';
      }
      return '/request-board';
    }

    const lowerTitle = item.title?.toLowerCase?.() ?? '';
    const lowerBody = item.body?.toLowerCase?.() ?? '';

    const isHanwhaWorkflowNotification =
      lowerTitle.includes('한화 위촉 승인') ||
      lowerTitle.includes('한화 위촉 반려') ||
      lowerBody.includes('한화 위촉이 승인') ||
      lowerBody.includes('한화 위촉이 반려') ||
      lowerBody.includes('승인 pdf');

    if (isHanwhaWorkflowNotification) {
      return '/hanwha-commission';
    }

    if (item.targetUrl) {
      return normalizeTargetUrl(item.targetUrl);
    }

    const category = (item.category ?? '').toLowerCase();

    if (category.includes('message') || lowerTitle.includes('메시지') || lowerBody.includes('메시지')) {
      return '/messenger?channel=garam';
    }
    if (category.startsWith('board_') || lowerTitle.includes('게시판') || lowerBody.includes('게시판')) {
      return '/board';
    }
    if (category.includes('exam_round') || lowerTitle.includes('시험 일정') || lowerBody.includes('시험 일정')) {
      return lowerTitle.includes('손해') || lowerBody.includes('손해') ? '/exam-apply2' : '/exam-apply';
    }
    if (category.includes('exam_apply') || lowerTitle.includes('시험 신청') || lowerBody.includes('시험 신청')) {
      return lowerTitle.includes('손해') || lowerBody.includes('손해') ? '/exam-apply2' : '/exam-apply';
    }
    if (category.includes('docs') || lowerTitle.includes('서류') || lowerBody.includes('서류')) {
      return '/docs-upload';
    }
    if (
      lowerTitle.includes('임시번호') ||
      lowerTitle.includes('임시사번') ||
      lowerBody.includes('임시번호') ||
      lowerBody.includes('임시사번') ||
      lowerTitle.includes('temp id') ||
      lowerBody.includes('temp id')
    ) {
      return '/consent';
    }
    if (lowerTitle.includes('수당') || lowerBody.includes('수당')) {
      return '/consent';
    }
    if (lowerTitle.includes('위촉') || lowerBody.includes('위촉')) {
      return '/appointment';
    }
    if (lowerTitle.includes('공지') || lowerBody.includes('공지')) {
      return '/notice';
    }

    return null;
  };

  const handlePressItem = (item: Notice) => {
    if (isDraggingRef.current) return;

    if (selectionModeRef.current) {
      if (ignoreNextPressIdRef.current === item.id) {
        ignoreNextPressIdRef.current = null;
        return;
      }
      toggleSelection(item.id);
      return;
    }

    const route = resolveNotificationRoute(item);
    if (route) {
      router.push(route as never);
      return;
    }

    if (item.origin === 'request_board') {
      Alert.alert(item.title, `${item.body}\n\n상세 내용은 설계요청(request_board)에서 확인할 수 있습니다.`, [{ text: '확인' }]);
      return;
    }

    Alert.alert(item.title, item.body, [{ text: '확인' }]);
  };

  const renderItem = ({ item, index }: { item: Notice; index: number }) => {
    const isNotice = item.source === 'notice';
    const isSelected = selectedIds.has(item.id);
    const iconName = isNotice ? 'mic' : 'bell';
    const iconColor = isSelected ? COLORS.primary : isNotice ? COLORS.primary : '#3B82F6';
    const bgIcon = isSelected ? '#FFE8D7' : isNotice ? '#FFF7ED' : '#EFF6FF';
    const categoryColor = isSelected ? COLORS.primary : isNotice ? COLORS.primary : COLORS.text.secondary;
    const dateColor = isSelected ? COLORS.primaryDark : COLORS.text.muted;
    const originLabel = getOriginLabel(item);
    const categoryLabel = getCategoryLabel(item);
    const isRequestBoard = item.origin === 'request_board';

    const onItemLayout = (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      const prev = itemHeightsRef.current.get(item.id);
      if (prev !== undefined && Math.abs(prev - height) < 0.5) return;
      itemHeightsRef.current.set(item.id, height);
      recomputeItemLayouts();
    };

    return (
      <MotiView
        from={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ delay: index * 50 }}
      >
        <Pressable
          style={[styles.itemContainer, isSelected ? styles.itemSelected : styles.itemUnselected]}
          onPress={() => handlePressItem(item)}
          onLongPress={() => handleLongPressItem(item.id)}
          onTouchMove={handlePressMoveItem}
          onPressOut={() => {
            if (dragSelectArmedRef.current && !isDraggingRef.current) {
              endDragSelection();
            } else if (!dragSelectArmedRef.current) {
              stopAutoScroll();
            }
          }}
          delayLongPress={350}
          android_ripple={selectionMode ? null : { color: '#F3F4F6' }}
          onLayout={onItemLayout}
        >
          <View style={[styles.iconBox, { backgroundColor: bgIcon }]}>
            <Feather name={iconName} size={20} color={iconColor} />
          </View>
          <View style={styles.contentBox}>
            <View style={styles.titleRow}>
              <View style={styles.metaLeft}>
                <View
                  style={[
                    styles.originBadge,
                    isRequestBoard ? styles.originBadgeRequestBoard : styles.originBadgeOnboarding,
                  ]}
                >
                  <Text style={styles.originBadgeText}>{originLabel}</Text>
                </View>
                <Text style={[styles.category, { color: categoryColor }]}>{categoryLabel}</Text>
              </View>
              <Text style={[styles.date, { color: dateColor }]}>
                {item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
          </View>
          <View
            style={[
              styles.checkContainer,
              selectionMode ? styles.checkContainerVisible : styles.checkContainerHidden,
              isSelected && styles.checkContainerSelected,
            ]}
          >
            <Feather
              name={isSelected ? 'check-circle' : 'circle'}
              size={20}
              color={isSelected ? COLORS.primary : '#D1D5DB'}
            />
          </View>
        </Pressable>
      </MotiView>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.header}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <Pressable onPress={cancelSelection}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={handleSelectAll} disabled={!notices.length}>
                <Text style={[styles.selectAllText, !notices.length && { opacity: 0.4 }]}>모두 선택</Text>
              </Pressable>
              <Text style={styles.selectionTitle}>{selectedIds.size}개 선택됨</Text>
              <Pressable onPress={handleDeleteSelected} disabled={!selectedIds.size}>
                <Text style={[styles.deleteText, !selectedIds.size && { opacity: 0.5 }]}>삭제</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.headerTitle}>알림 센터</Text>
            <RefreshButton onPress={load} />
          </>
        )}
      </View>

      {selectionMode && (
        <View style={styles.dragHint}>
          <Feather name={isDragging ? 'move' : 'info'} size={13} color={COLORS.primary} />
          <Text style={styles.dragHintText}>
            {isDragging ? '드래그하여 선택 중...' : '꾹 눌러 드래그하면 여러 항목을 한번에 선택할 수 있습니다'}
          </Text>
        </View>
      )}

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <View
          ref={listContainerRef}
          style={{ flex: 1 }}
          onTouchMove={(event: GestureResponderEvent) => {
            if (!dragSelectArmedRef.current) return;
            if (!isDraggingRef.current) {
              setIsDragging(true);
            }
            updateDragPointer(event.nativeEvent.pageY);
            selectByContainerY(event.nativeEvent.pageY);
          }}
          onTouchEnd={() => {
            if (dragSelectArmedRef.current) {
              endDragSelection();
            } else {
              stopAutoScroll();
            }
          }}
          onTouchCancel={() => {
            if (dragSelectArmedRef.current) {
              endDragSelection();
            } else {
              stopAutoScroll();
            }
          }}
          onLayout={() => {
            listContainerRef.current?.measureInWindow((_x, y) => {
              listTopRef.current = y;
            });
          }}
        >
          <FlatList
            ref={flatListRef}
            data={notices}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            scrollEnabled={!dragArmed && !isDragging}
            onLayout={(event) => {
              const { height } = event.nativeEvent.layout;
              listContainerHeightRef.current = height;
              listContainerRef.current?.measureInWindow((_x, y) => {
                listTopRef.current = y;
              });
            }}
            onContentSizeChange={(_width, height) => {
              listContentHeightRef.current = height;
            }}
            onScroll={(evt) => {
              scrollOffsetRef.current = evt.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                enabled={!selectionMode && !dragArmed && !isDragging}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Feather name="bell-off" size={48} color="#E5E7EB" />
                <Text style={styles.emptyText}>새로운 알림이 없습니다.</Text>
              </View>
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    minHeight: 64,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text.primary },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 20, paddingBottom: 40 },

  dragHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#FFF7ED',
    borderBottomWidth: 1,
    borderBottomColor: '#FED7AA',
  },
  dragHintText: { fontSize: 12, color: COLORS.primary, fontWeight: '500', flex: 1 },

  itemContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'flex-start',
  },
  itemSelected: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: '#FFF1E6',
  },
  itemUnselected: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
  },
  checkContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkContainerVisible: {
    opacity: 1,
  },
  checkContainerHidden: {
    opacity: 0,
  },
  checkContainerSelected: {
    backgroundColor: '#FFE8D7',
    borderColor: '#FDC8A5',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  contentBox: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingRight: 8 },
  originBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  originBadgeRequestBoard: {
    backgroundColor: '#DBEAFE',
  },
  originBadgeOnboarding: {
    backgroundColor: '#FFEDD5',
  },
  originBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  category: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  date: { fontSize: 12, color: '#9CA3AF' },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  body: { fontSize: 14, color: COLORS.text.secondary, lineHeight: 20 },

  emptyState: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.text.secondary },

  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  cancelText: { fontSize: 14, color: COLORS.text.secondary, fontWeight: '600' },
  selectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  deleteText: { fontSize: 14, color: '#EF4444', fontWeight: '700' },
  selectAllText: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },
});

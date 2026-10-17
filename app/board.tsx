import { randomUUID } from 'expo-crypto';
import { createCommentRequestTracker } from '@/lib/board-comment-request';
import { QueryReadState } from '@/components/QueryReadState';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  BackHandler,
  Dimensions,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTopActionBar } from '@/components/AppTopActionBar';
import { BottomNavigation } from '@/components/BottomNavigation';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { KeyboardSafeBottomBar } from '@/components/KeyboardSafeBottomBar';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { PdfViewerModal } from '@/components/PdfViewerModal';
import { showToast } from '@/components/Toast';
import { LinkifiedSelectableText } from '@/components/LinkifiedSelectableText';
import { ListSkeleton } from '@/components/LoadingSkeleton';
import { DEFAULT_REACTIONS, ReactionPicker } from '@/components/ReactionPicker';
import { useAppLogout } from '@/hooks/use-app-logout';
import { useBoardList } from '@/hooks/use-board-list';
import { getFreshBoardAttachments, openBoardAttachment } from '@/lib/board-attachment-actions';
import { showBoardFeedbackAlert } from '@/lib/board-feedback-alerts';
import {
  applyBoardReactionUpdate,
  buildBoardReactionCounts,
  type BoardReactionKey,
} from '@/lib/board-reaction-state';
import { showBoardCommentActions } from '@/lib/board-comment-actions';
import { getBoardFileKind, splitBoardPostLead } from '@/lib/board-detail-layout';
import { buildBoardPostShareContent } from '@/lib/board-share-link';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { useReadSessionScope } from '@/hooks/use-read-session-scope';
import { useSession } from '@/hooks/use-session';
import { NotificationReceiptStatusBanner } from '@/lib/notification-receipt-ui';
import {
  hasPresentRouteParam,
  parseExactlyOneUuidRouteParam,
} from '@/lib/strict-route-params';
import { useNotificationReceiptCompletion } from '@/lib/use-notification-receipt';
import {
  BoardDetail,
  BoardListItem,
  buildBoardActor,
  createBoardComment,
  deleteBoardComment,
  fetchBoardCategories,
  fetchBoardDetail,
  formatFileSize,
  logBoardError,
  toggleBoardReaction,
  toggleCommentLike,
  updateBoardComment
} from '@/lib/board-api';
import {
  BOARD_LIST_SORT_LABELS,
  BoardListSortOption,
} from '@/lib/board-list-query';
import {
  patchBoardListPageViewedPost,
  patchBoardListViewedPost,
  type BoardListPage,
  type BoardListPages,
} from '@/lib/board-list-pages';
import { downloadRemoteFileToUserStorage, loadFileSharing, shareRemoteFile } from '@/lib/native-file-actions';
import { openExternalUrl } from '@/lib/open-external-url';
import { getBoardAuthorRoleLabel, getBoardRoleBadgeStyle } from '@/lib/staff-identity';
import { ANIMATION } from '@/lib/theme';
import { buildWelcomeTitle } from '@/lib/welcome-title';
import { safeDecodeFileName } from '@/lib/validation';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
// Older store builds lack the native share module; their share buttons stay hidden.
const CAN_SHARE_FILES = loadFileSharing() !== null;
const BOARD_SHARE_BASE_URL = process.env.EXPO_PUBLIC_GARAMIN_SHARE_BASE_URL
  ?? process.env.EXPO_PUBLIC_INVITE_BASE_URL;
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

const getCategoryTheme = (categoryName: string) => {
  const normalized = categoryName.trim().toLowerCase();
  if (normalized.includes('공지')) {
    return { backgroundColor: '#FFF7ED', borderColor: '#FED7AA', textColor: '#C2410C' };
  }
  if (normalized.includes('교육')) {
    return { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', textColor: '#1D4ED8' };
  }
  if (normalized.includes('상품') || normalized.includes('추천') || normalized.includes('가람') || normalized.includes('pick')) {
    return { backgroundColor: '#FDF2F8', borderColor: '#FBCFE8', textColor: '#BE185D' };
  }
  if (normalized.includes('시책')) {
    return { backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', textColor: '#4338CA' };
  }
  return { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB', textColor: '#4B5563' };
};

type ReactionMutationContext = {
  previousDetail?: BoardDetail;
  previousMyReaction: BoardReactionKey | null | undefined;
};
type CommentLikeMutationContext = {
  detailKey: (string | number)[];
  previousDetail?: BoardDetail;
};
const toAttachmentPreviewImages = (attachments: BoardDetail['attachments']) =>
  attachments
    .filter((item) => item.fileType === 'image' && !!item.signedUrl)
    .map((item) => ({
      id: item.id,
      url: item.signedUrl as string,
      title: safeDecodeFileName(item.fileName),
      fileSize: item.fileSize,
    }));

type PreviewModalState = {
  images: { id: string; url: string; title?: string }[];
  initialIndex: number;
};

type PdfViewerState = { attachmentId: string; url: string; title: string };

const safeText = (value?: string | null) => (typeof value === 'string' ? value : '');
const getInitial = (value?: string | null) => {
  const normalized = safeText(value).trim();
  return normalized ? normalized.charAt(0) : '?';
};

type BoardPost = BoardListItem;

const buildPlaceholderPost = (postId: string): BoardPost => {
  const now = new Date().toISOString();
  return {
    id: postId,
    categoryId: '',
    title: '',
    contentPreview: '',
    authorName: '',
    authorRole: 'manager',
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    isMine: false,
    stats: {
      commentCount: 0,
      reactionCount: 0,
      attachmentCount: 0,
      viewCount: 0,
    },
    reactions: {
      like: 0,
      heart: 0,
      check: 0,
      smile: 0,
    },
    attachments: [],
  };
};

type CommentLikeButtonProps = {
  liked: boolean;
  count: number;
  onPress: () => void;
};

type AttachmentPreviewThumbProps = {
  uri?: string;
};

const MUST_READ_VISIBLE_COUNT = 3;

const formatBoardListDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }
  const monthDay = `${date.getMonth() + 1}.${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? monthDay
    : `${String(date.getFullYear()).slice(2)}.${monthDay}`;
};

type BoardPostRowProps = {
  post: BoardListItem;
  categoryName: string;
  isLast: boolean;
  onPress: () => void;
};

function BoardPostRow({ post, categoryName, isLast, onPress }: BoardPostRowProps) {
  // Missing read state (older list function) reads as "already seen" so nothing looks falsely new.
  const unread = post.isRead === false;
  const categoryTheme = getCategoryTheme(categoryName);
  const firstImage = post.attachments?.find((item) => item.fileType === 'image');
  const fileCount = post.attachments?.filter((item) => item.fileType === 'file').length ?? 0;
  const title = safeText(post.title);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? '안 읽음, ' : ''}${categoryName}, ${title}`}
      style={({ pressed }) => [styles.row, !isLast && styles.rowDivider, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTopMeta}>
          {unread && <View style={styles.unreadDot} />}
          <Text style={[styles.rowCategory, { color: categoryTheme.textColor }]} numberOfLines={1}>
            {categoryName}
          </Text>
          <Text style={styles.rowDate}>{formatBoardListDate(post.createdAt)}</Text>
        </View>
        <Text style={[styles.rowTitle, !unread && styles.rowTitleRead]} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.rowBottomMeta}>
          <Text style={styles.rowMetaText} numberOfLines={1}>{safeText(post.authorName)}</Text>
          {fileCount > 0 && (
            <View style={styles.rowMetaItem}>
              <Feather name="paperclip" size={12} color={TEXT_MUTED} />
              <Text style={styles.rowMetaText}>{fileCount}</Text>
            </View>
          )}
          {post.stats.commentCount > 0 && (
            <View style={styles.rowMetaItem}>
              <Feather name="message-circle" size={12} color={TEXT_MUTED} />
              <Text style={styles.rowMetaText}>{post.stats.commentCount}</Text>
            </View>
          )}
        </View>
      </View>
      {firstImage && <AttachmentPreviewThumb uri={firstImage.signedUrl} />}
    </Pressable>
  );
}

function CommentLikeButton({ liked, count, onPress }: CommentLikeButtonProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!liked) return;
    scale.value = withSequence(
      withSpring(1.2, ANIMATION.spring.snappy),
      withSpring(1, ANIMATION.spring.bouncy),
    );
  }, [liked, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      style={({ pressed }) => [
        styles.commentLikeButton,
        liked && styles.commentLikeButtonActive,
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => {
        scale.value = withSequence(
          withSpring(1.15, ANIMATION.spring.snappy),
          withSpring(1, ANIMATION.spring.bouncy),
        );
        onPress();
      }}
    >
      <Animated.View style={animatedStyle}>
        <Feather
          name="heart"
          size={14}
          color={liked ? '#ef4444' : TEXT_MUTED}
        />
      </Animated.View>
      <Text style={[styles.commentLikeText, liked && styles.commentLikeTextActive]}>
        {count}
      </Text>
    </Pressable>
  );
}

function AttachmentPreviewThumb({ uri }: AttachmentPreviewThumbProps) {
  const [failed, setFailed] = useState(!uri);

  useEffect(() => {
    setFailed(!uri);
  }, [uri]);

  return (
    <View style={styles.attachmentThumb}>
      {!failed && uri ? (
        <Image
          source={{ uri }}
          style={styles.attachmentThumbImage}
          resizeMethod="resize"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.attachmentThumbPlaceholder}>
          <Feather name="image" size={16} color={TEXT_MUTED} />
        </View>
      )}
    </View>
  );
}

type BoardMustReadSectionProps = {
  posts: BoardListItem[];
  resolveCategoryName: (categoryId?: string | null) => string;
  onSelect: (post: BoardListItem) => void;
};

function BoardMustReadSection({ posts, resolveCategoryName, onSelect }: BoardMustReadSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const unreadCount = posts.filter((post) => post.isRead === false).length;
  const visiblePosts = expanded ? posts : posts.slice(0, MUST_READ_VISIBLE_COUNT);
  const hiddenCount = posts.length - MUST_READ_VISIBLE_COUNT;
  return (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 420 }}
      style={styles.mustReadSection}
    >
      <View style={styles.mustReadHeader}>
        <Feather name="bookmark" size={15} color={HANWHA_ORANGE} />
        <Text style={styles.mustReadTitle}>필독</Text>
        {unreadCount > 0 && (
          <View style={styles.mustReadCount} accessibilityLabel={`안 읽은 필독 ${unreadCount}건`}>
            <Text style={styles.mustReadCountText}>{unreadCount}</Text>
          </View>
        )}
      </View>
      {visiblePosts.map((post, index) => (
        <BoardPostRow
          key={post.id}
          post={post}
          categoryName={resolveCategoryName(post.categoryId)}
          isLast={index === visiblePosts.length - 1}
          onPress={() => onSelect(post)}
        />
      ))}
      {hiddenCount > 0 && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.mustReadToggle, pressed && { opacity: 0.6 }]}
          onPress={() => setExpanded((current) => !current)}
        >
          <Text style={styles.mustReadToggleText}>
            {expanded ? '접기' : `필독 ${hiddenCount}건 더 보기`}
          </Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={TEXT_MUTED} />
        </Pressable>
      )}
    </MotiView>
  );
}

export default function BoardScreen() {
  const sessionScope = useReadSessionScope();
  return <BoardScreenContent key={sessionScope} sessionScope={sessionScope} />;
}

function BoardScreenContent({ sessionScope }: { sessionScope: number }) {
  const router = useRouter();
  const appLogout = useAppLogout();
  const { postId, notificationId, notificationTarget } = useLocalSearchParams<{
    postId?: string;
    notificationId?: string;
    notificationTarget?: string;
  }>();
  const navigation = useNavigation();
  const { role, displayName, residentId, readOnly, hydrated, isRequestBoardDesigner, staffType } = useSession();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const homeHeaderTitle = buildWelcomeTitle({
    role,
    readOnly,
    isRequestBoardDesigner,
    staffType,
    displayName,
    fallbackTitle: '홈',
  });

  const actor = useMemo(
    () => buildBoardActor({ role, residentId, displayName, readOnly }),
    [displayName, readOnly, residentId, role],
  );
  const navPreset = resolveBottomNavPreset({
    role,
    readOnly,
    hydrated,
    isRequestBoardDesigner,
  });
  const navActiveKey = resolveBottomNavActiveKey(
    navPreset,
    isRequestBoardDesigner ? 'request-board' : 'board',
  );

  const [refreshing, setRefreshing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BoardPost | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewModalState | null>(null);
  const [pdfViewer, setPdfViewer] = useState<PdfViewerState | null>(null);
  const [savingAttachmentId, setSavingAttachmentId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<BoardListSortOption>('created');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<string[]>([]);
  const [isThreadInitialized, setIsThreadInitialized] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    authorName: string;
    parentId: string;
    threadRootId: string;
  } | null>(null);
  // undefined = not yet set (use server data), null = cleared, BoardReactionKey = selected
  const [myReactionOverride, setMyReactionOverride] = useState<BoardReactionKey | null | undefined>(undefined);
  const routePostId = useMemo(() => {
    return parseExactlyOneUuidRouteParam(postId) ?? '';
  }, [postId]);
  const hasInvalidPostRoute =
    hasPresentRouteParam(postId) && !routePostId;

  // Scroll animation for bottom nav
  const lastScrollY = useSharedValue(0);
  const bottomNavTranslateY = useSharedValue(0);
  const modalTranslateY = useSharedValue(0);
  const closeModal = useCallback(() => {
    setSelectedPost(null);
    if (routePostId) {
      router.setParams({ postId: undefined } as any);
    }
  }, [routePostId, router]);
  const closePreviewImage = useCallback(() => setPreviewImage(null), []);
  const animateCloseModal = useCallback(() => {
    modalTranslateY.value = withTiming(
      screenHeight,
      { duration: 200 },
      (finished) => {
        if (finished) {
          runOnJS(closeModal)();
        }
      },
    );
  }, [closeModal, modalTranslateY, screenHeight]);
  const modalPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate((event) => {
          if (event.translationY > 0) {
            modalTranslateY.value = event.translationY;
          }
        })
        .onEnd((event) => {
          const shouldClose = event.translationY > 140 || event.velocityY > 1200;
          if (shouldClose) {
            runOnJS(animateCloseModal)();
            return;
          }
          modalTranslateY.value = withSpring(0, { damping: 24, stiffness: 150, overshootClamping: true });
        }),
    [animateCloseModal, modalTranslateY],
  );

  // 모달 열기/닫기 애니메이션 - selectedPost.id만 추적하여 반응 업데이트 시 재실행 방지
  const selectedPostId = selectedPost?.id ?? null;
  useEffect(() => {
    if (!selectedPostId) {
      modalTranslateY.value = 0;
      return;
    }
    modalTranslateY.value = screenHeight;
    modalTranslateY.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [modalTranslateY, screenHeight, selectedPostId]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      const dy = currentY - lastScrollY.value;

      if (currentY < 0) {
        bottomNavTranslateY.value = withTiming(0);
      } else if (currentY > 0) {
        if (dy > 10) {
          bottomNavTranslateY.value = withTiming(200, { duration: 300 });
        } else if (dy < -10) {
          bottomNavTranslateY.value = withTiming(0, { duration: 300 });
        }
      }
      lastScrollY.value = currentY;
    },
  });

  const bottomNavAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bottomNavTranslateY.value }],
  }));
  const modalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: modalTranslateY.value }],
  }));

  // Queries
  const { data: categories } = useQuery({
    queryKey: ['board-categories'],
    queryFn: () => {
      if (!actor) return Promise.resolve([]);
      return fetchBoardCategories(actor);
    },
    enabled: !!actor,
  });

  const {
    posts, isLoading, isError, error: listError, refetch,
    hasNextPage, fetchNextPage, isFetching, isFetchingNextPage, isFetchNextPageError,
  } = useBoardList({
    sessionScope,
    selectedCategoryId,
    sortOption,
    searchQuery,
  });

  const { data: detailData, isError: isDetailError, error: detailError, isFetching: isDetailFetching, refetch: refetchDetail } = useQuery({
    queryKey: ['board-detail', selectedPostId, sessionScope],
    queryFn: () => {
      if (!actor || !selectedPostId) return Promise.resolve(null as unknown as BoardDetail);
      return fetchBoardDetail(actor, selectedPostId);
    },
    enabled: !!actor && !!selectedPostId,
  });
  const notificationReceipt = useNotificationReceiptCompletion({
    params: { notificationId, notificationTarget },
    expectedTarget: !hasInvalidPostRoute && routePostId
      ? { version: 1, kind: 'board_post', postId: routePostId }
      : null,
    loadState: hasInvalidPostRoute
      ? 'error'
      : isDetailError
      ? 'error'
      : detailData?.post?.id === routePostId
        ? 'success'
        : 'loading',
  });

  useEffect(() => {
    if (!actor || !detailData?.post?.id) return;
    const nextViewCount = detailData.post.viewCount;
    if (typeof nextViewCount !== 'number') return;

    const targetPostId = detailData.post.id;

    setSelectedPost((prev) => {
      if (!prev || prev.id !== targetPostId) return prev;
      return {
        ...prev,
        stats: {
          ...prev.stats,
          viewCount: nextViewCount,
        },
      };
    });

    queryClient.setQueriesData<BoardListPages>(
      {
        queryKey: ['board-posts', actor.role, actor.residentId],
        predicate: (query) => query.queryKey[6] === 'infinite' && query.queryKey[7] === sessionScope,
      },
      (current) => patchBoardListViewedPost(current, targetPostId, nextViewCount),
    );
    // The FC home preview keeps its own single-page list; clear its unread mark too.
    queryClient.setQueriesData<BoardListPage>(
      {
        queryKey: ['board-posts', actor.role, actor.residentId, 'home'],
      },
      (current) => patchBoardListPageViewedPost(current, targetPostId, nextViewCount),
    );
  }, [actor, detailData?.post?.id, detailData?.post?.viewCount, queryClient, sessionScope]);

  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((category) => {
      map.set(category.id, category.name);
    });
    return map;
  }, [categories]);
  const resolveCategoryName = useCallback(
    (rawCategoryId?: string | null) => categoryNameMap.get(rawCategoryId ?? '') ?? '일반',
    [categoryNameMap],
  );
  const hasCompleteDetail = detailData?.post.id === selectedPostId && !isDetailError;
  const modalPost = hasCompleteDetail ? detailData?.post : null;
  const modalAttachments = useMemo(() => detailData?.attachments ?? [], [detailData?.attachments]);
  const fallbackReactions = selectedPost?.reactions ?? {
    like: 0,
    heart: 0,
    check: 0,
    smile: 0,
  };
  const modalReactions = detailData?.reactions ?? {
    ...fallbackReactions,
    myReaction: null,
  };
  const modalAttachmentImages = useMemo(() => toAttachmentPreviewImages(modalAttachments), [modalAttachments]);
  const modalFileAttachments = useMemo(() => modalAttachments.filter((item) => item.fileType === 'file'), [modalAttachments]);
  // The first paragraph leads the first screen, right above the attachments; the rest follows as body.
  const modalLead = useMemo(() => splitBoardPostLead(modalPost?.content), [modalPost?.content]);
  const loadFreshAttachments = useCallback(
    () => getFreshBoardAttachments(modalAttachments, detailData?.attachmentsSignedAt ?? 0, async () => {
      const result = await refetchDetail();
      return result.isError ? null : result.data?.attachments;
    }),
    [detailData?.attachmentsSignedAt, modalAttachments, refetchDetail],
  );
  const openAttachmentImagePreview = useCallback(async (attachmentId: string) => {
    const images = toAttachmentPreviewImages((await loadFreshAttachments()) ?? []);
    if (images.length === 0) {
      Alert.alert('오류', '첨부파일을 열 수 없습니다.');
      return;
    }
    setPreviewImage({
      images: images.map((image) => ({ id: image.id, url: image.url, title: image.title })),
      initialIndex: Math.max(images.findIndex((image) => image.id === attachmentId), 0),
    });
  }, [loadFreshAttachments]);
  const openExternalAttachment = useCallback(async (attachmentId: string) => {
    const attachments = await loadFreshAttachments();
    await openBoardAttachment({
      signedUrl: attachments?.find((item) => item.id === attachmentId)?.signedUrl,
      openExternalUrl,
      alert: Alert.alert,
      logError: logBoardError,
    });
  }, [loadFreshAttachments]);
  // PDFs open in the in-app viewer; other documents (HWP, Office) still need another app.
  const openFileAttachment = useCallback(async (attachmentId: string) => {
    const attachment = (await loadFreshAttachments())?.find((item) => item.id === attachmentId);
    if (attachment?.signedUrl && getBoardFileKind(attachment.fileName, attachment.mimeType) === 'PDF') {
      setPdfViewer({ attachmentId, url: attachment.signedUrl, title: safeDecodeFileName(attachment.fileName) });
      return;
    }
    await openExternalAttachment(attachmentId);
  }, [loadFreshAttachments, openExternalAttachment]);
  const saveAttachment = useCallback(async (attachmentId: string) => {
    if (savingAttachmentId) return;
    setSavingAttachmentId(attachmentId);
    try {
      const attachment = (await loadFreshAttachments())?.find((item) => item.id === attachmentId);
      if (!attachment?.signedUrl) throw new Error('첨부파일 주소를 불러오지 못했습니다.');
      await downloadRemoteFileToUserStorage({
        url: attachment.signedUrl,
        fileName: safeDecodeFileName(attachment.fileName),
        mimeType: attachment.mimeType,
        tempPrefix: 'board-attachment',
        fallbackFileName: `board-attachment-${attachmentId}`,
      });
      showToast({ message: '다운로드 폴더에 저장했어요.', variant: 'success' });
    } catch (error) {
      logBoardError('attachment-save', error);
      Alert.alert('저장 실패', error instanceof Error && error.message ? error.message : '첨부파일을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSavingAttachmentId(null);
    }
  }, [loadFreshAttachments, savingAttachmentId]);
  // Saving and sharing both download the file, so they share the busy state.
  const shareAttachment = useCallback(async (attachmentId: string) => {
    if (savingAttachmentId) return;
    setSavingAttachmentId(attachmentId);
    try {
      const attachment = (await loadFreshAttachments())?.find((item) => item.id === attachmentId);
      if (!attachment?.signedUrl) throw new Error('첨부파일 주소를 불러오지 못했습니다.');
      await shareRemoteFile({
        url: attachment.signedUrl,
        fileName: safeDecodeFileName(attachment.fileName),
        mimeType: attachment.mimeType,
        fallbackFileName: `board-attachment-${attachmentId}`,
      });
    } catch (error) {
      logBoardError('attachment-share', error);
      Alert.alert('공유 실패', error instanceof Error && error.message ? error.message : '첨부파일을 공유하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSavingAttachmentId(null);
    }
  }, [loadFreshAttachments, savingAttachmentId]);
  const modalReactionCounts = {
    like: modalReactions.like,
    heart: modalReactions.heart,
    check: modalReactions.check,
    smile: modalReactions.smile,
  };
  // myReactionOverride takes priority: undefined = use server, null/key = local value
  const effectiveMyReaction: BoardReactionKey | null =
    myReactionOverride !== undefined ? myReactionOverride : (modalReactions.myReaction ?? null);
  const modalComments = useMemo(() => detailData?.comments ?? [], [detailData?.comments]);
  const threadedComments = useMemo(() => {
    const roots = modalComments.filter((comment) => !comment.parentId);
    const repliesByParent = new Map<string, typeof modalComments>();
    modalComments
      .filter((comment) => comment.parentId)
      .forEach((comment) => {
        const list = repliesByParent.get(comment.parentId as string) ?? [];
        list.push(comment);
        repliesByParent.set(comment.parentId as string, list);
      });
    return { roots, repliesByParent };
  }, [modalComments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useEffect(() => {
    if (!routePostId || !actor) return;

    const fromList = posts.find((item) => item.id === routePostId) ?? null;
    setSelectedPost((prev) => {
      if (prev?.id === routePostId) return prev;
      return fromList ?? buildPlaceholderPost(routePostId);
    });
  }, [actor, posts, routePostId]);

  // Reset reaction override whenever a different post is opened
  useEffect(() => {
    setMyReactionOverride(undefined);
  }, [selectedPostId]);

  // Add reaction mutation
  const addReactionMutation = useMutation<
    { myReaction: BoardReactionKey | null },
    Error,
    { postId: string; reactionType: BoardReactionKey },
    ReactionMutationContext | undefined
  >({
    mutationFn: async ({ postId, reactionType }: { postId: string; reactionType: BoardReactionKey }) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return toggleBoardReaction(actor, postId, reactionType);
    },
    onMutate: async ({ postId, reactionType }) => {
      if (!actor) return undefined;

      const detailKey = ['board-detail', postId, sessionScope];
      // Do NOT cancel the detail query — cancelling an in-flight initial fetch
      // causes React Query to revert to "loading" state and auto-retry, which
      // appears as a page reload. myReactionOverride handles the UI state locally.
      const previousDetail = queryClient.getQueryData<BoardDetail>(detailKey);
      const previousMyReaction = myReactionOverride;

      // effectiveMyReaction captures the current state (override > server > null)
      const currentMyReaction = effectiveMyReaction;
      const currentCounts = buildBoardReactionCounts(previousDetail?.reactions ?? modalReactions);
      const { nextCounts, nextMyReaction } = applyBoardReactionUpdate(currentCounts, currentMyReaction, reactionType);

      // Optimistically update detail cache (if already loaded)
      if (previousDetail) {
        queryClient.setQueryData<BoardDetail>(detailKey, {
          ...previousDetail,
          reactions: {
            ...previousDetail.reactions,
            ...nextCounts,
            myReaction: nextMyReaction,
          },
        });
      }

      // Always update local reaction state immediately (no waiting for server)
      setMyReactionOverride(nextMyReaction);

      return { previousDetail, previousMyReaction };
    },
    onError: (error, variables, context) => {
      const detailKey = ['board-detail', variables.postId, sessionScope];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      // Revert local reaction state
      if (selectedPostId === variables.postId) {
        setMyReactionOverride(context?.previousMyReaction);
      }
      logBoardError('reaction', error);
      showBoardFeedbackAlert(Alert.alert, 'reaction-failed');
    },
    onSuccess: (data, variables) => {
      if (!data) return;
      const detailKey = ['board-detail', variables.postId, sessionScope];
      queryClient.setQueryData<BoardDetail>(detailKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          reactions: {
            ...current.reactions,
            myReaction: data.myReaction ?? null,
          },
        };
      });
      // Confirm local state with server response
      if (selectedPostId === variables.postId) {
        setMyReactionOverride(data.myReaction ?? null);
      }
    },
  });

  const commentOwnerActive = useRef(true);
  useEffect(() => {
    commentOwnerActive.current = true;
    return () => { commentOwnerActive.current = false; };
  }, []);

  const commentRequests = useRef(createCommentRequestTracker(randomUUID));

  // Add comment mutation
  const addCommentMutation = useMutation({
    networkMode: 'always',
    mutationFn: async ({
      postId,
      content,
      parentId,
      requestId,
      scope,
    }: {
      postId: string;
      requestId: string;
      scope: string | number;
      detailKey: readonly unknown[];
      content: string;
      parentId?: string;
      threadRootId?: string;
    }) => {
      if (!commentOwnerActive.current || !actor || scope !== sessionScope) throw new Error('로그인이 필요합니다.');
      return createBoardComment(actor, { postId, content, parentId, requestId });
    },
    onSuccess: (_data, variables) => {
      commentRequests.current.complete(variables.requestId);
      if (!commentOwnerActive.current) return;
      if (selectedPostId === variables.postId && variables.scope === sessionScope) {
        setCommentText((current) => current.trim() === variables.content ? '' : current);
        setReplyTarget((current) => (
          current?.parentId === variables.parentId ? null : current
        ));
        if (variables.threadRootId) {
          setCollapsedThreadIds((current) => (
            current.filter((commentId) => commentId !== variables.threadRootId)
          ));
        }
      }
      queryClient.invalidateQueries({ queryKey: variables.detailKey });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error, variables) => {
      if (!commentOwnerActive.current || variables.scope !== sessionScope) return;
      showBoardFeedbackAlert(Alert.alert, 'comment-create-failed');
      logBoardError('comment', error);
    },
  });

  const toggleCommentLikeMutation = useMutation<
    { liked: boolean; likeCount: number },
    Error,
    string,
    CommentLikeMutationContext | undefined
  >({
    mutationFn: async (commentId: string) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return toggleCommentLike(actor, commentId);
    },
    onMutate: async (commentId: string) => {
      if (!actor || !selectedPostId) return undefined;
      const detailKey = ['board-detail', selectedPostId, sessionScope];
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previousDetail = queryClient.getQueryData<BoardDetail>(detailKey);

      if (previousDetail) {
        queryClient.setQueryData<BoardDetail>(detailKey, {
          ...previousDetail,
          comments: previousDetail.comments.map((comment) => {
            if (comment.id !== commentId) return comment;
            const nextLiked = !comment.isLiked;
            const nextCount = Math.max(0, comment.stats.likeCount + (nextLiked ? 1 : -1));
            return {
              ...comment,
              isLiked: nextLiked,
              stats: {
                ...comment.stats,
                likeCount: nextCount,
              },
            };
          }),
        });
      }

      return { detailKey, previousDetail };
    },
    onError: (error, _commentId, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
      logBoardError('comment-like', error);
      showBoardFeedbackAlert(Alert.alert, 'comment-like-failed');
    },
    onSuccess: (data, commentId, context) => {
      if (!context) return;
      queryClient.setQueryData<BoardDetail>(context.detailKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          comments: current.comments.map((comment) => (
            comment.id === commentId
              ? {
                ...comment,
                isLiked: data.liked,
                stats: {
                  ...comment.stats,
                  likeCount: data.likeCount,
                },
              }
              : comment
          )),
        };
      });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return updateBoardComment(actor, { commentId, content });
    },
    onSuccess: () => {
      setEditingCommentId(null);
      setEditingCommentText('');
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId, sessionScope] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error) => {
      logBoardError('comment-update', error);
      showBoardFeedbackAlert(Alert.alert, 'comment-update-failed');
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return deleteBoardComment(actor, commentId);
    },
    onSuccess: () => {
      setEditingCommentId(null);
      setEditingCommentText('');
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId, sessionScope] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error) => {
      logBoardError('comment-delete', error);
      showBoardFeedbackAlert(Alert.alert, 'comment-delete-failed');
    },
  });

  const handleAddComment = () => {
    if (!selectedPost || !actor || addCommentMutation.isPending) return;
    if (!commentText.trim()) {
      showBoardFeedbackAlert(Alert.alert, 'empty-comment');
      return;
    }
    const requestId = commentRequests.current.requestId({
      scope: sessionScope, postId: selectedPost.id, parentId: replyTarget?.parentId, content: commentText,
    });
    addCommentMutation.mutate({
      scope: sessionScope,
      detailKey: ['board-detail', selectedPost.id, sessionScope],
      requestId,
      postId: selectedPost.id,
      content: commentText.trim(),
      parentId: replyTarget?.parentId,
      threadRootId: replyTarget?.threadRootId,
    });
  };

  const openCommentActions = (comment: (typeof modalComments)[number]) => {
    showBoardCommentActions({
      alert: Alert.alert,
      onEdit: () => {
        setEditingCommentId(comment.id);
        setEditingCommentText(safeText(comment.content));
      },
      onDelete: () => deleteCommentMutation.mutate(comment.id),
    });
  };

  const toggleThread = useCallback((commentId: string) => {
    setCollapsedThreadIds((prev) => (
      prev.includes(commentId) ? prev.filter((id) => id !== commentId) : [...prev, commentId]
    ));
  }, []);

  const renderCommentThread = (
    comment: (typeof modalComments)[number],
    depth = 0,
    threadRootId = comment.id,
  ) => {
    const replies = threadedComments.repliesByParent.get(comment.id) ?? [];
    const isReply = depth > 0;
    const isCollapsed = depth === 0 && collapsedThreadIds.includes(comment.id);
    const replyStyle = depth >= 2 ? styles.replyItemDeep : styles.replyItem;
    return (
      <View
        key={comment.id}
        style={[
          isReply ? replyStyle : styles.commentItem,
          isReply && { marginLeft: depth * 14 },
        ]}
      >
        <View style={styles.commentHeader}>
          <View style={styles.avatarSmall}>
            <Text style={styles.avatarTextSmall}>{getInitial(comment.authorName)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.commentAuthor}>{safeText(comment.authorName)}</Text>
              <View style={styles.commentRoleBadge}>
                <Text style={styles.commentRoleText}>
                  {getBoardAuthorRoleLabel(comment.authorRole)}
                </Text>
              </View>
            </View>
            <Text style={styles.commentDate}>
              {new Date(comment.createdAt).toLocaleDateString('ko-KR')}
              {comment.editedAt ? ' · 수정됨' : ''}
            </Text>
          </View>
          {comment.isMine && (
            <Pressable accessibilityLabel="댓글 더보기" accessibilityRole="button"
              style={({ pressed }) => [
                styles.commentMoreButton,
                pressed && { opacity: 0.6 },
              ]}
              onPress={() => openCommentActions(comment)}
            >
              <Feather name="more-vertical" size={16} color={TEXT_MUTED} />
            </Pressable>
          )}
        </View>
        {editingCommentId === comment.id ? (
          <View style={styles.commentEditBox}>
            <TextInput
              style={styles.commentEditInput}
              value={editingCommentText}
              onChangeText={setEditingCommentText}
              multiline
            />
            <View style={styles.commentEditActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.commentEditButton,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => {
                  const trimmed = editingCommentText.trim();
                  if (!trimmed) {
                    showBoardFeedbackAlert(Alert.alert, 'empty-comment');
                    return;
                  }
                  updateCommentMutation.mutate({ commentId: comment.id, content: trimmed });
                }}
              >
                <Text style={styles.commentEditButtonText}>수정</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.commentEditButton,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => {
                  setEditingCommentId(null);
                  setEditingCommentText('');
                }}
              >
                <Text style={styles.commentEditButtonText}>취소</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <LinkifiedSelectableText text={comment.content} style={styles.commentContent} />
        )}
        <View style={styles.commentActions}>
          <Pressable
            style={styles.replyButton}
            onPress={() => setReplyTarget({
              id: comment.id,
              authorName: comment.authorName,
              parentId: comment.id,
              threadRootId,
            })}
          >
            <Text style={styles.replyButtonText}>답글</Text>
          </Pressable>
          <CommentLikeButton
            liked={comment.isLiked}
            count={comment.stats.likeCount}
            onPress={() => toggleCommentLikeMutation.mutate(comment.id)}
          />
        </View>
        {depth === 0 && replies.length > 0 && (
          <Pressable style={styles.threadToggle} onPress={() => toggleThread(comment.id)}>
            <Feather name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={14} color={TEXT_MUTED} />
            <Text style={styles.threadToggleText}>
              {isCollapsed ? `답글 ${replies.length}개 보기` : '답글 접기'}
            </Text>
          </Pressable>
        )}
        {replies.length > 0 && !isCollapsed && (
          <View style={styles.replyList}>
            {replies.map((reply) => renderCommentThread(reply, depth + 1, threadRootId))}
          </View>
        )}
      </View>
    );
  };

  useEffect(() => {
    if (!selectedPost) {
      setEditingCommentId(null);
      setEditingCommentText('');
      setReplyTarget(null);
      setCollapsedThreadIds([]);
      setIsThreadInitialized(false);
      setPreviewImage(null);
      setPdfViewer(null);
    }
  }, [selectedPost]);

  useEffect(() => {
    if (!selectedPost || isThreadInitialized) return;

    // 댓글 데이터가 로드되었는지 확인 (빈 배열일 수도 있으므로 길이 체크는 신중히)
    // 여기서는 threadedComments가 계산된 시점에 실행됨

    const initialCollapsed = threadedComments.roots
      .filter((comment) => (threadedComments.repliesByParent.get(comment.id)?.length ?? 0) > 0)
      .map((comment) => comment.id);

    // 댓글이 있는데 초기화되지 않았다면 초기화 수행
    if (modalComments.length > 0) {
      setCollapsedThreadIds(initialCollapsed);
      setIsThreadInitialized(true);
    }
  }, [isThreadInitialized, modalComments.length, selectedPost, threadedComments]);

  // 서버가 고정 글을 페이지마다 앞에 붙이므로 필독과 일반 글을 나눠 보여준다.
  const mustReadPosts = useMemo(() => posts.filter((post) => post.isPinned), [posts]);
  const regularPosts = useMemo(() => posts.filter((post) => !post.isPinned), [posts]);

  const contentBottomPadding = (role === 'admin' ? 160 : 96) + (insets.bottom || 0);
  const modalTopGap = Math.max(insets.top + 12, 24);
  const commentBarInset = 96;
  const handleLogout = () => {
    appLogout();
  };

  const handleSharePost = useCallback(async (post?: { id?: string | null; title?: string | null } | null) => {
    const postIdValue = safeText(post?.id).trim();
    if (!postIdValue) {
      Alert.alert('오류', '공유할 게시글 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      const shareContent = buildBoardPostShareContent({
        postId: postIdValue,
        title: post?.title,
        shareBaseUrl: BOARD_SHARE_BASE_URL,
      });
      await Share.share(shareContent);
    } catch (error) {
      logBoardError('share', error);
      Alert.alert('오류', '게시글 공유 링크를 만들 수 없습니다.');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!selectedPost) return;
      event.preventDefault();
      animateCloseModal();
    });
    return unsubscribe;
  }, [animateCloseModal, navigation, selectedPost]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (selectedPost) {
          animateCloseModal();
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [animateCloseModal, selectedPost]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <AppTopActionBar
        title={homeHeaderTitle}
        onLogout={handleLogout}
        onOpenNotifications={() => router.push('/notifications')}
      />
      <NotificationReceiptStatusBanner
        state={notificationReceipt.state}
        onRetry={() => void notificationReceipt.retryMarkRead()}
      />
      <View style={styles.pageTitleWrap}>
        <Text style={styles.title}>게시판</Text>
      </View>

      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: contentBottomPadding }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* 검색 바 */}
        <View style={[styles.searchContainer, selectedPost && styles.searchContainerHidden]} pointerEvents={selectedPost ? 'none' : 'auto'}>
          <Feather name="search" size={16} color={TEXT_MUTED} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="제목, 내용 검색"
            placeholderTextColor={TEXT_MUTED}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={() => setSearchQuery(searchInput)}
            returnKeyType="search"
          />
          {searchInput.length > 0 && (
            <Pressable accessibilityLabel="검색어 지우기" accessibilityRole="button"
              onPress={() => {
                setSearchInput('');
                setSearchQuery('');
              }}
              style={styles.searchClear}
            >
              <Feather name="x" size={16} color={TEXT_MUTED} />
            </Pressable>
          )}
        </View>

        {/* 카테고리 필터 & 정렬 */}
        <View style={[styles.filterRow, selectedPost && styles.searchContainerHidden]} pointerEvents={selectedPost ? 'none' : 'auto'}>
          <ScrollView keyboardShouldPersistTaps="always" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChips}>
            <Pressable
              style={[styles.categoryChip, !selectedCategoryId && styles.categoryChipActive]}
              onPress={() => setSelectedCategoryId(null)}
            >
              <Text style={[styles.categoryChipText, !selectedCategoryId && styles.categoryChipTextActive]}>전체</Text>
            </Pressable>
            {(categories ?? []).map((cat) => (
              <Pressable
                key={cat.id}
                style={[styles.categoryChip, selectedCategoryId === cat.id && styles.categoryChipActive]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text style={[styles.categoryChipText, selectedCategoryId === cat.id && styles.categoryChipTextActive]}>
                  {cat.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            style={styles.sortButton}
            onPress={() => setShowSortMenu(!showSortMenu)}
          >
            <Feather name="sliders" size={16} color={CHARCOAL} />
            <Text style={styles.sortButtonText}>{BOARD_LIST_SORT_LABELS[sortOption]}</Text>
            <Feather name="chevron-down" size={14} color={TEXT_MUTED} />
          </Pressable>
        </View>

        {/* 정렬 메뉴 */}
        {showSortMenu && (
          <View style={styles.sortMenu}>
            {(Object.entries(BOARD_LIST_SORT_LABELS) as [BoardListSortOption, string][]).map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.sortMenuItem, sortOption === key && styles.sortMenuItemActive]}
                onPress={() => {
                  setSortOption(key);
                  setShowSortMenu(false);
                }}
              >
                <Text style={[styles.sortMenuItemText, sortOption === key && styles.sortMenuItemTextActive]}>
                  {label}
                </Text>
                {sortOption === key && <Feather name="check" size={16} color={HANWHA_ORANGE} />}
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.container}>
          {isLoading && !refreshing && <ListSkeleton count={5} itemHeight={88} />}

          {isError && !isFetchNextPageError && (
            <QueryReadState error={listError} message="게시글을 불러오지 못했습니다." onRetry={() => void refetch()} />
          )}

          {!isLoading && !isError && posts.length === 0 && (
            <View style={styles.emptyBox}>
              <Feather name="inbox" size={40} color={BORDER} />
              <Text style={styles.emptyText}>{searchQuery ? '검색 결과가 없습니다.' : '등록된 게시글이 없습니다.'}</Text>
            </View>
          )}

          {mustReadPosts.length > 0 && (
            <BoardMustReadSection
              posts={mustReadPosts}
              resolveCategoryName={resolveCategoryName}
              onSelect={setSelectedPost}
            />
          )}

          {regularPosts.length > 0 && (
            <View style={styles.listGroup}>
              {regularPosts.map((post, index) => (
                <MotiView
                  key={post.id}
                  from={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ type: 'timing', duration: 360, delay: Math.min(index, 10) * 40 }}
                >
                  <BoardPostRow
                    post={post}
                    categoryName={resolveCategoryName(post.categoryId)}
                    isLast={index === regularPosts.length - 1}
                    onPress={() => setSelectedPost(post)}
                  />
                </MotiView>
              ))}
            </View>
          )}
          {isFetchNextPageError && (
            <QueryReadState
              error={listError}
              message="이전 게시글을 불러오지 못했습니다."
              onRetry={() => void fetchNextPage({ cancelRefetch: false })}
              retrying={isFetching}
            />
          )}
          {hasNextPage && !isFetchNextPageError && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="이전 게시글 더 보기"
              accessibilityState={{ disabled: isFetching, busy: isFetchingNextPage }}
              disabled={isFetching}
              onPress={() => void fetchNextPage({ cancelRefetch: false })}
              style={({ pressed }) => [styles.loadMoreButton, pressed && { opacity: 0.7 }]}
            >
              {isFetchingNextPage && <ActivityIndicator size="small" color={HANWHA_ORANGE} />}
              <Text style={styles.loadMoreText}>{isFetchingNextPage ? '이전 게시글 불러오는 중...' : '이전 게시글 더 보기'}</Text>
            </Pressable>
          )}
        </View>
      </Animated.ScrollView>

      {/* 하단 네비게이션 바 (스크롤시 사라짐) */}
      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        animatedStyle={bottomNavAnimatedStyle as any}
        bottomInset={insets.bottom}
      />

      {/* 게시글 상세 모달 */}
      {selectedPost && (
        <View style={[styles.modal, { paddingTop: modalTopGap }]}>
          <Pressable style={styles.modalOverlay} onPress={animateCloseModal} />
          <Animated.View style={[styles.modalContent, modalAnimatedStyle]}>
            <View style={styles.modalContentInner}>
              <GestureDetector gesture={modalPanGesture}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalGrabber} />
                  <View style={styles.modalHeaderActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="게시글 공유"
                      style={({ pressed }) => [styles.modalIconButton, pressed && { opacity: 0.65 }]}
                      onPress={() => handleSharePost(modalPost)}
                    >
                      <Feather name="share-2" size={21} color={TEXT_MUTED} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="게시글 상세 닫기"
                      style={({ pressed }) => [styles.modalIconButton, pressed && { opacity: 0.65 }]}
                      onPress={animateCloseModal}
                    >
                      <Feather name="x" size={24} color={CHARCOAL} />
                    </Pressable>
                  </View>
                </View>
              </GestureDetector>

              <KeyboardAwareWrapper
                style={styles.modalBody}
                contentContainerStyle={{ paddingBottom: commentBarInset + insets.bottom, flexGrow: 1 }}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="none"
              >
                {!hasCompleteDetail ? (
                  <QueryReadState
                    error={detailError}
                    message={isDetailError ? '게시글 상세를 불러오지 못했습니다.' : '게시글을 불러오는 중...'}
                    onRetry={isDetailError ? () => void refetchDetail() : undefined}
                    retrying={isDetailFetching}
                  />
                ) : (<>
                <View style={styles.detailBadges}>
                  {modalPost?.isPinned && (
                    <View style={styles.mustReadBadge}>
                      <Feather name="bookmark" size={11} color="#fff" />
                      <Text style={styles.mustReadBadgeText}>필독</Text>
                    </View>
                  )}
                  {(() => {
                    const categoryName = resolveCategoryName(modalPost?.categoryId);
                    const categoryTheme = getCategoryTheme(categoryName);
                    return (
                      <View
                        style={[
                          styles.categoryBadge,
                          styles.categoryBadgeInline,
                          {
                            backgroundColor: categoryTheme.backgroundColor,
                            borderColor: categoryTheme.borderColor,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.categoryBadgeText, { color: categoryTheme.textColor }]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {categoryName}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                <Text style={styles.modalPostTitle} selectable>{safeText(modalPost?.title)}</Text>

                <View style={styles.detailAuthorBadgeRow}>
                  <Text style={styles.detailMetaAuthor} numberOfLines={1}>
                    {safeText(modalPost?.authorName)}
                  </Text>
                  <View style={[styles.roleBadge, styles.detailRoleBadge, { backgroundColor: getBoardRoleBadgeStyle(modalPost?.authorRole ?? 'manager').backgroundColor }]}>
                    <Text style={[styles.roleText, { color: getBoardRoleBadgeStyle(modalPost?.authorRole ?? 'manager').color }]}>
                      {getBoardAuthorRoleLabel(modalPost?.authorRole ?? 'manager')}
                    </Text>
                  </View>
                  <Text style={styles.detailMetaText}>
                    {modalPost?.createdAt
                      ? new Date(modalPost.createdAt).toLocaleDateString('ko-KR', {
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                      : ''}
                    {` · 조회 ${modalPost?.viewCount ?? 0}`}
                  </Text>
                </View>

                {modalLead.lead ? (
                  <View style={styles.leadBox}>
                    <LinkifiedSelectableText text={modalLead.lead} style={styles.leadText} />
                  </View>
                ) : null}

                {modalAttachments.length > 0 && (
                  <View style={styles.attachmentSection}>
                    <Text style={styles.attachmentHeading}>첨부 {modalAttachments.length}</Text>

                    {modalFileAttachments.map((item) => {
                      const kind = getBoardFileKind(item.fileName, item.mimeType);
                      const fileName = safeDecodeFileName(item.fileName);
                      const size = formatFileSize(item.fileSize);
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${fileName}, ${kind}${size ? `, ${size}` : ''} 열기`}
                          style={({ pressed }) => [styles.fileCard, pressed && styles.fileCardPressed]}
                          onPress={() => {
                            void openFileAttachment(item.id);
                          }}
                        >
                          <View style={[styles.fileKind, kind === 'PDF' && styles.fileKindPdf]}>
                            <Text style={[styles.fileKindText, kind === 'PDF' && styles.fileKindTextPdf]}>{kind}</Text>
                          </View>
                          <View style={styles.fileCardBody}>
                            <Text style={styles.fileCardName} numberOfLines={2}>{fileName}</Text>
                            <Text style={styles.fileCardMeta}>{size ? `${kind} · ${size}` : kind}</Text>
                          </View>
                          {CAN_SHARE_FILES ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`${fileName} 공유`}
                              disabled={!!savingAttachmentId}
                              hitSlop={6}
                              style={({ pressed }) => [styles.fileSaveButton, pressed && { opacity: 0.6 }]}
                              onPress={() => {
                                void shareAttachment(item.id);
                              }}
                            >
                              <Feather name="share-2" size={18} color={TEXT_MUTED} />
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${fileName} 저장`}
                            accessibilityState={{ busy: savingAttachmentId === item.id, disabled: !!savingAttachmentId }}
                            disabled={!!savingAttachmentId}
                            hitSlop={6}
                            style={({ pressed }) => [styles.fileSaveButton, pressed && { opacity: 0.6 }]}
                            onPress={() => {
                              void saveAttachment(item.id);
                            }}
                          >
                            {savingAttachmentId === item.id
                              ? <ActivityIndicator size="small" color={TEXT_MUTED} />
                              : <Feather name="download" size={18} color={TEXT_MUTED} />}
                          </Pressable>
                        </Pressable>
                      );
                    })}

                    {modalAttachmentImages.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        keyboardShouldPersistTaps="always"
                        contentContainerStyle={styles.imageStrip}
                      >
                        {modalAttachmentImages.map((item, index) => (
                          <Pressable
                            key={item.id}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`이미지 ${index + 1}/${modalAttachmentImages.length} 크게 보기`}
                            style={({ pressed }) => [
                              styles.imageThumb,
                              modalAttachmentImages.length === 1 && styles.imageSingle,
                              pressed && { opacity: 0.75 },
                            ]}
                            onPress={() => {
                              void openAttachmentImagePreview(item.id);
                            }}
                          >
                            <Image
                              source={{ uri: item.url }}
                              style={styles.imageThumbImage}
                              resizeMethod="resize"
                              resizeMode={modalAttachmentImages.length === 1 ? 'contain' : 'cover'}
                            />
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}

                {modalLead.rest ? (
                  <LinkifiedSelectableText text={modalLead.rest} style={styles.modalPostContent} />
                ) : null}

                <View style={styles.divider} />

                {/* 감정 표현 버튼 */}
                <View style={styles.reactionsSection}>
                  <Text style={styles.sectionTitle}>반응 남기기</Text>
                  <ReactionPicker
                    reactions={DEFAULT_REACTIONS}
                    onReact={(reactionId) => addReactionMutation.mutate({ postId: selectedPost.id, reactionType: reactionId as BoardReactionKey })}
                    reactionCounts={modalReactionCounts}
                    selectedReactions={effectiveMyReaction ? [effectiveMyReaction] : []}
                    showLabels={false}
                  />
                </View>

                <View style={styles.divider} />

                {/* 댓글 섹션 */}
                <View style={styles.commentsSection}>
                  <Text style={styles.sectionTitle}>댓글 ({modalComments.length || 0})</Text>

                  {threadedComments.roots.length > 0 ? (
                    threadedComments.roots.map((comment) => renderCommentThread(comment))
                  ) : (
                    <Text style={styles.noComments}>첫 댓글을 남겨보세요!</Text>
                  )}
                </View>

                </>)}
              </KeyboardAwareWrapper>
              {/* 댓글 작성 */}
              {hasCompleteDetail && <KeyboardSafeBottomBar
                contentContainerStyle={[
                  styles.commentBar,
                  { paddingBottom: Math.max(insets.bottom + 16, 28) },
                ]}
              >
                {replyTarget && (
                  <View style={styles.replyBanner}>
                    <Text style={styles.replyBannerText}>{replyTarget.authorName}님에게 답글</Text>
                    <Pressable accessibilityLabel="답글 취소" accessibilityRole="button"
                      style={({ pressed }) => [styles.replyCancel, pressed && { opacity: 0.6 }]}
                      onPress={() => setReplyTarget(null)}
                    >
                      <Feather name="x" size={14} color={TEXT_MUTED} />
                    </Pressable>
                  </View>
                )}
                <View style={styles.commentInput}>
                  <TextInput
                    style={styles.commentTextInput}
                    placeholder={replyTarget ? '답글을 입력하세요...' : '댓글을 입력하세요...'}
                    placeholderTextColor={TEXT_MUTED}
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <Pressable accessibilityLabel="댓글 전송" accessibilityRole="button" accessibilityState={{ disabled: !commentText.trim() || addCommentMutation.isPending }}
                    style={[styles.commentSubmitButton, !commentText.trim() && { opacity: 0.5 }]}
                    onPress={handleAddComment}
                    disabled={!commentText.trim() || addCommentMutation.isPending}
                  >
                    <Feather name="send" size={18} color="#fff" />
                  </Pressable>
                </View>
              </KeyboardSafeBottomBar>}
            </View>
          </Animated.View>
        </View>
      )}

      <ImagePreviewModal
        visible={!!previewImage}
        images={previewImage?.images ?? []}
        initialIndex={previewImage?.initialIndex ?? 0}
        onClose={closePreviewImage}
        onSave={(index) => {
          const imageId = previewImage?.images[index]?.id;
          if (imageId) void saveAttachment(imageId);
        }}
        onShare={CAN_SHARE_FILES ? (index) => {
          const imageId = previewImage?.images[index]?.id;
          if (imageId) void shareAttachment(imageId);
        } : undefined}
        saving={!!savingAttachmentId}
      />
      <PdfViewerModal
        visible={!!pdfViewer}
        url={pdfViewer?.url ?? null}
        title={pdfViewer?.title ?? ''}
        onClose={() => setPdfViewer(null)}
        onSave={() => {
          if (pdfViewer) void saveAttachment(pdfViewer.attachmentId);
        }}
        onShare={CAN_SHARE_FILES ? () => {
          if (pdfViewer) void shareAttachment(pdfViewer.attachmentId);
        } : undefined}
        saving={!!savingAttachmentId}
        onOpenExternal={() => {
          if (pdfViewer) void openExternalAttachment(pdfViewer.attachmentId);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  pageTitleWrap: {
    marginHorizontal: 20,
    marginBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: CHARCOAL },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  searchContainerHidden: {
    opacity: 0,
  },
  searchIcon: { position: 'absolute', left: 36, zIndex: 1 },
  searchInput: {
    flex: 1,
    height: 44,
    paddingLeft: 40,
    paddingRight: 40,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 15,
    color: CHARCOAL,
  },
  searchClear: {
    position: 'absolute',
    right: 24,
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    gap: 8,
  },
  categoryChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  categoryChipActive: {
    backgroundColor: HANWHA_ORANGE,
    borderColor: HANWHA_ORANGE,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: TEXT_MUTED,
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: BORDER,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: CHARCOAL,
  },
  sortMenu: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    ...CARD_SHADOW,
  },
  sortMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  sortMenuItemActive: {
    backgroundColor: '#fef3eb',
  },
  sortMenuItemText: {
    fontSize: 14,
    color: CHARCOAL,
  },
  sortMenuItemTextActive: {
    color: HANWHA_ORANGE,
    fontWeight: '600',
  },
  container: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  mustReadSection: {
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingTop: 12,
    overflow: 'hidden',
  },
  mustReadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  mustReadTitle: { fontSize: 15, fontWeight: '800', color: '#C2410C' },
  mustReadCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mustReadCountText: { fontSize: 11, fontWeight: '800', color: '#fff', includeFontPadding: false },
  mustReadToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: '#FED7AA',
  },
  mustReadToggleText: { fontSize: 13, fontWeight: '700', color: TEXT_MUTED },
  listGroup: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  rowPressed: { backgroundColor: 'rgba(17,24,39,0.04)' },
  rowMain: { flex: 1, minWidth: 0, gap: 4 },
  rowTopMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: HANWHA_ORANGE },
  rowCategory: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  rowDate: { fontSize: 12, color: TEXT_MUTED },
  rowTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: CHARCOAL },
  rowTitleRead: { fontWeight: '500', color: '#4B5563' },
  rowBottomMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowMetaText: { fontSize: 12, color: TEXT_MUTED, flexShrink: 1 },
  detailBadges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  mustReadBadge: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: HANWHA_ORANGE,
  },
  mustReadBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff', includeFontPadding: false },
  detailAuthorBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  detailMetaAuthor: { fontSize: 13, fontWeight: '700', color: CHARCOAL, flexShrink: 1 },
  detailRoleBadge: { minHeight: 22, paddingHorizontal: 8, paddingVertical: 2 },
  detailMetaText: { fontSize: 12, color: TEXT_MUTED },
  categoryBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    maxWidth: '100%',
  },
  categoryBadgeInline: {
    marginBottom: 0,
    flexShrink: 0,
  },
  categoryBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    includeFontPadding: false,
  },
  roleBadge: {
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    includeFontPadding: false,
  },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },
  attachmentThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  attachmentThumbImage: { width: '100%', height: '100%' },
  attachmentThumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: TEXT_MUTED },
  loadMoreButton: { minHeight: 48, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff' },
  loadMoreText: { fontSize: 14, fontWeight: '700', color: HANWHA_ORANGE },

  // Modal
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '95%',
    flex: 1,
    ...CARD_SHADOW,
  },
  modalContentInner: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 0,
    backgroundColor: '#fff',
  },
  modalGrabber: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -20,
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: BORDER,
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { paddingHorizontal: 24, paddingTop: 0, paddingBottom: 14 },
  modalPostTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: CHARCOAL,
    marginBottom: 10,
    lineHeight: 30,
  },
  modalPostContent: {
    marginTop: 20,
    fontSize: 17,
    color: CHARCOAL,
    lineHeight: 28,
  },
  leadBox: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
  },
  leadText: { fontSize: 17, lineHeight: 26, fontWeight: '700', color: CHARCOAL },
  attachmentHeading: { fontSize: 13, fontWeight: '700', color: TEXT_MUTED },
  fileCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  fileCardPressed: { backgroundColor: '#F9FAFB' },
  fileKind: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileKindPdf: { backgroundColor: '#FEE2E2' },
  fileKindText: { fontSize: 12, fontWeight: '800', color: '#4B5563', includeFontPadding: false },
  fileKindTextPdf: { color: '#B91C1C' },
  fileCardBody: { flex: 1, minWidth: 0, gap: 2 },
  fileCardName: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: CHARCOAL },
  fileCardMeta: { fontSize: 12, color: TEXT_MUTED },
  fileSaveButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  imageStrip: { gap: 8 },
  imageThumb: {
    width: 112,
    height: 112,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#F9FAFB',
  },
  imageThumbImage: { width: '100%', height: '100%' },
  // A lone image (often a schedule table) gets the full width so it reads without opening the viewer.
  imageSingle: { width: Dimensions.get('window').width - 48, height: Math.round((Dimensions.get('window').width - 48) * 0.75) },
  reactionsSection: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 12,
  },
  attachmentSection: { marginTop: 16, gap: 8 },
  commentsSection: { marginBottom: 20 },
  commentItem: {
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    marginBottom: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  commentMoreButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTextSmall: { color: '#fff', fontSize: 12, fontWeight: '600' },
  commentAuthor: { fontSize: 13, fontWeight: '600', color: CHARCOAL },
  commentRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  commentRoleText: { fontSize: 10, fontWeight: '600', color: TEXT_MUTED },
  commentDate: { fontSize: 11, color: TEXT_MUTED },
  commentContent: { fontSize: 14, color: CHARCOAL, lineHeight: 20 },
  commentEditBox: { gap: 8 },
  commentEditInput: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    fontSize: 14,
    color: CHARCOAL,
  },
  commentEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  commentEditButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  commentEditButtonText: { fontSize: 12, fontWeight: '600', color: CHARCOAL },
  commentActions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  replyButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  replyButtonText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  commentLikeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
  },
  commentLikeButtonActive: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  commentLikeText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  commentLikeTextActive: { color: '#ef4444' },
  noComments: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: 'center',
    paddingVertical: 20,
  },
  replyList: { marginTop: 12, gap: 10 },
  replyItem: {
    padding: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  replyItemDeep: {
    padding: 12,
    backgroundColor: '#EEF2F7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  threadToggle: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  threadToggleText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
  },
  replyBannerText: { fontSize: 12, fontWeight: '600', color: TEXT_MUTED },
  replyCancel: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentBar: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  commentInput: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  commentTextInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 14,
    color: CHARCOAL,
  },
  commentSubmitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

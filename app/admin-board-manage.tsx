import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  Dimensions,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolate,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { CardSkeleton } from '@/components/LoadingSkeleton';
import { AppTopActionBar } from '@/components/AppTopActionBar';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { LinkifiedSelectableText } from '@/components/LinkifiedSelectableText';
import { ReactionPicker, DEFAULT_REACTIONS } from '@/components/ReactionPicker';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { ANIMATION } from '@/lib/theme';
import { buildWelcomeTitle } from '@/lib/welcome-title';
import { safeDecodeFileName } from '@/lib/validation';
import {
  BoardDetail,
  BoardListItem,
  buildBoardActor,
  createBoardComment,
  deleteBoardComment,
  deleteBoardPost,
  fetchBoardCategories,
  fetchBoardDetail,
  fetchBoardList,
  formatFileSize,
  logBoardError,
  updateBoardComment,
  toggleBoardReaction,
  toggleCommentLike,
} from '@/lib/board-api';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

type ReactionKey = 'like' | 'heart' | 'check' | 'smile';
type ReactionCounts = Record<ReactionKey, number>;
type ReactionMutationContext = {
  previousDetail?: BoardDetail;
  previousMyReaction: ReactionKey | null | undefined;
};
type CommentLikeMutationContext = {
  previousDetail?: BoardDetail;
};
type PreviewModalState = {
  images: { url: string; title?: string }[];
  initialIndex: number;
};

const safeText = (value?: string | null) => (typeof value === 'string' ? value : '');
const getInitial = (value?: string | null) => {
  const normalized = safeText(value).trim();
  return normalized ? normalized.charAt(0) : '?';
};

const getCategoryTheme = (categoryName: string) => {
  const normalized = categoryName.trim().toLowerCase();
  if (normalized === '공지') {
    return { backgroundColor: '#fff7ed', borderColor: '#fed7aa', textColor: '#c2410c' };
  }
  if (normalized === '교육') {
    return { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', textColor: '#1d4ed8' };
  }
  if (normalized === '서류') {
    return { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', textColor: '#166534' };
  }
  return { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', textColor: '#374151' };
};

const buildReactionCounts = (counts?: Partial<ReactionCounts>): ReactionCounts => ({
  like: counts?.like ?? 0,
  heart: counts?.heart ?? 0,
  check: counts?.check ?? 0,
  smile: counts?.smile ?? 0,
});

const applyReactionUpdate = (
  currentCounts: ReactionCounts,
  currentReaction: ReactionKey | null,
  nextReaction: ReactionKey,
) => {
  const nextCounts = { ...currentCounts };
  let nextMyReaction: ReactionKey | null = nextReaction;
  let delta = 0;

  if (currentReaction === nextReaction) {
    nextMyReaction = null;
    nextCounts[nextReaction] = Math.max(0, nextCounts[nextReaction] - 1);
    delta = -1;
  } else {
    if (currentReaction) {
      nextCounts[currentReaction] = Math.max(0, nextCounts[currentReaction] - 1);
    }
    nextCounts[nextReaction] = nextCounts[nextReaction] + 1;
    delta = currentReaction ? 0 : 1;
  }

  return { nextCounts, nextMyReaction, delta };
};

type BoardPost = BoardListItem;

type CommentLikeButtonProps = {
  liked: boolean;
  count: number;
  onPress: () => void;
};

type AttachmentPreviewThumbProps = {
  uri?: string;
};

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

export default function AdminBoardManageScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { role, displayName, residentId, readOnly, isRequestBoardDesigner, hydrated, logout } = useSession();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardPadding = useKeyboardPadding();
  const screenHeight = Dimensions.get('window').height;
  const bottomNavHeight = 72;
  const homeHeaderTitle = buildWelcomeTitle({
    role,
    readOnly,
    isRequestBoardDesigner,
    displayName,
    fallbackTitle: '홈',
  });

  const actor = useMemo(
    () => buildBoardActor({ role, residentId, displayName, readOnly }),
    [displayName, readOnly, residentId, role],
  );
  const isManager = actor?.role === 'manager';
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

  useEffect(() => {
    if (role === 'admin' && isRequestBoardDesigner) {
      router.replace('/request-board');
    }
  }, [isRequestBoardDesigner, role, router]);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BoardPost | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewModalState | null>(null);
  const [commentText, setCommentText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<string[]>([]);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    authorName: string;
    parentId: string;
  } | null>(null);
  // undefined = not yet set (use server data), null = cleared, ReactionKey = selected
  const [myReactionOverride, setMyReactionOverride] = useState<ReactionKey | null | undefined>(undefined);

  // Scroll animation for bottom nav
  const lastScrollY = useSharedValue(0);
  const bottomNavTranslateY = useSharedValue(0);
  const modalTranslateY = useSharedValue(0);
  const fabProgress = useSharedValue(1);
  const closeModal = useCallback(() => setSelectedPost(null), []);
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

  const openedPostId = selectedPost?.id ?? null;
  useEffect(() => {
    if (!openedPostId) {
      modalTranslateY.value = 0;
      return;
    }
    modalTranslateY.value = screenHeight;
    modalTranslateY.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [modalTranslateY, screenHeight, openedPostId]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      const dy = currentY - lastScrollY.value;

      if (currentY < 0) {
        bottomNavTranslateY.value = withTiming(0);
        fabProgress.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
      } else if (currentY > 0) {
        if (dy > 10) {
          bottomNavTranslateY.value = withTiming(200, { duration: 300 });
          fabProgress.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
        } else if (dy < -10) {
          bottomNavTranslateY.value = withTiming(0, { duration: 300 });
          fabProgress.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
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
  const fabAnimatedStyle = useAnimatedStyle(() => ({
    width: interpolate(fabProgress.value, [0, 1], [48, 120], Extrapolate.CLAMP),
  }));
  const fabShiftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          bottomNavTranslateY.value,
          [0, 200],
          [0, bottomNavHeight - 6],
          Extrapolate.CLAMP,
        ),
      },
    ],
  }));
  const fabLabelContainerStyle = useAnimatedStyle(() => ({
    width: interpolate(fabProgress.value, [0, 1], [0, 60], Extrapolate.CLAMP),
    opacity: interpolate(fabProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
    marginLeft: interpolate(fabProgress.value, [0, 1], [0, 8], Extrapolate.CLAMP),
  }));

  // Queries
  const { data: listData, isLoading, isError, refetch } = useQuery({
    queryKey: ['board-posts', actor?.role, actor?.residentId],
    queryFn: () => {
      if (!actor) return Promise.resolve({ items: [], nextCursor: null });
      return fetchBoardList(actor, { limit: 20 });
    },
    enabled: !!actor,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['board-categories', actor?.role, actor?.residentId],
    queryFn: () => {
      if (!actor) return Promise.resolve([]);
      return fetchBoardCategories(actor);
    },
    enabled: !!actor,
  });

  const selectedPostId = selectedPost?.id ?? null;
  const { data: detailData } = useQuery({
    queryKey: ['board-detail', selectedPostId],
    queryFn: () => {
      if (!actor || !selectedPostId) return Promise.resolve(null as unknown as BoardDetail);
      return fetchBoardDetail(actor, selectedPostId);
    },
    enabled: !!actor && !!selectedPostId,
  });

  const posts = useMemo(() => listData?.items ?? [], [listData]);
  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((category) => {
      map.set(category.id, category.name);
    });
    return map;
  }, [categories]);
  const resolveCategoryName = useCallback(
    (rawCategoryId?: string | null) => categoryNameMap.get(rawCategoryId ?? '') ?? '일반',
    [categoryNameMap],
  );
  const modalPost = detailData?.post ?? (selectedPost
    ? {
      id: selectedPost.id,
      categoryId: selectedPost.categoryId,
      title: selectedPost.title,
      content: selectedPost.contentPreview,
      authorName: selectedPost.authorName,
      authorRole: selectedPost.authorRole,
      createdAt: selectedPost.createdAt,
      updatedAt: selectedPost.updatedAt,
      editedAt: selectedPost.editedAt,
      isPinned: selectedPost.isPinned,
      isMine: selectedPost.isMine,
      viewCount: selectedPost.stats.viewCount ?? 0,
    }
    : null);
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
  const modalAttachmentImages = useMemo(
    () =>
      modalAttachments
        .filter((item) => item.fileType === 'image' && !!item.signedUrl)
        .map((item) => ({
          id: item.id,
          url: item.signedUrl as string,
          title: safeDecodeFileName(item.fileName),
          fileSize: item.fileSize,
        })),
    [modalAttachments],
  );
  const modalReactionCounts = {
    like: modalReactions.like,
    heart: modalReactions.heart,
    check: modalReactions.check,
    smile: modalReactions.smile,
  };
  const effectiveMyReaction: ReactionKey | null =
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
  const handleLogout = () => {
    logout();
  };

  useEffect(() => {
    setMyReactionOverride(undefined);
  }, [selectedPostId]);

  // Add reaction mutation
  const addReactionMutation = useMutation<
    { myReaction: ReactionKey | null },
    Error,
    { postId: string; reactionType: ReactionKey },
    ReactionMutationContext | undefined
  >({
    mutationFn: async ({ postId, reactionType }: { postId: string; reactionType: ReactionKey }) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return toggleBoardReaction(actor, postId, reactionType);
    },
    onMutate: async ({ postId, reactionType }) => {
      if (!actor) return undefined;

      const detailKey = ['board-detail', postId];
      const previousDetail = queryClient.getQueryData<BoardDetail>(detailKey);
      const previousMyReaction = myReactionOverride;
      const currentCounts = buildReactionCounts(previousDetail?.reactions ?? modalReactions);
      const currentMyReaction = effectiveMyReaction;
      const { nextCounts, nextMyReaction } = applyReactionUpdate(currentCounts, currentMyReaction, reactionType);

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

      setMyReactionOverride(nextMyReaction);

      return { previousDetail, previousMyReaction };
    },
    onError: (error, variables, context) => {
      const detailKey = ['board-detail', variables.postId];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      setMyReactionOverride(context?.previousMyReaction);
      logBoardError('reaction', error);
      Alert.alert('오류', '반응 처리에 실패했습니다.');
    },
    onSuccess: (data, variables) => {
      if (!data) return;
      const detailKey = ['board-detail', variables.postId];
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
      setMyReactionOverride(data.myReaction ?? null);
    },
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async ({ postId, content, parentId }: { postId: string; content: string; parentId?: string }) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return createBoardComment(actor, { postId, content, parentId });
    },
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error) => {
      Alert.alert('오류', '댓글 작성에 실패했습니다.');
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
      const detailKey = ['board-detail', selectedPostId];
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

      return { previousDetail };
    },
    onError: (error, _commentId, context) => {
      const detailKey = ['board-detail', selectedPostId];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      logBoardError('comment-like', error);
      Alert.alert('오류', '댓글 좋아요 처리에 실패했습니다.');
    },
    onSuccess: (data, commentId) => {
      if (!selectedPostId) return;
      const detailKey = ['board-detail', selectedPostId];
      queryClient.setQueryData<BoardDetail>(detailKey, (current) => {
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
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error) => {
      logBoardError('comment-update', error);
      Alert.alert('오류', '댓글 수정에 실패했습니다.');
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
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
    },
    onError: (error) => {
      logBoardError('comment-delete', error);
      Alert.alert('오류', '댓글 삭제에 실패했습니다.');
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return deleteBoardPost(actor, postId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      if (selectedPostId) {
        queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      }
      animateCloseModal();
    },
    onError: (error) => {
      logBoardError('post-delete', error);
      Alert.alert('오류', '게시글 삭제에 실패했습니다.');
    },
  });

  const handleAddComment = () => {
    if (!selectedPost) return;
    if (!commentText.trim()) {
      Alert.alert('입력 오류', '댓글 내용을 입력해주세요.');
      return;
    }
    addCommentMutation.mutate({
      postId: selectedPost.id,
      content: commentText.trim(),
      parentId: replyTarget?.parentId,
    });
    setReplyTarget(null);
  };

  const openCommentActions = (comment: (typeof modalComments)[number]) => {
    Alert.alert('댓글 관리', undefined, [
      {
        text: '수정',
        onPress: () => {
          setEditingCommentId(comment.id);
          setEditingCommentText(safeText(comment.content));
        },
      },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => deleteCommentMutation.mutate(comment.id),
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const toggleThread = useCallback((commentId: string) => {
    setCollapsedThreadIds((prev) => (
      prev.includes(commentId) ? prev.filter((id) => id !== commentId) : [...prev, commentId]
    ));
  }, []);

  const renderCommentThread = (comment: (typeof modalComments)[number], depth = 0) => {
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
                  {comment.authorRole === 'admin' ? '관리자' : comment.authorRole === 'manager' ? '본부장' : 'FC'}
                </Text>
              </View>
            </View>
            <Text style={styles.commentDate}>
              {new Date(comment.createdAt).toLocaleDateString('ko-KR')}
              {comment.editedAt ? ' · 수정됨' : ''}
            </Text>
          </View>
          {comment.isMine && (
            <Pressable
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
                    Alert.alert('입력 오류', '댓글 내용을 입력해주세요.');
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
            onPress={() => setReplyTarget({ id: comment.id, authorName: comment.authorName, parentId: comment.id })}
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
            {replies.map((reply) => renderCommentThread(reply, depth + 1))}
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
      setPreviewImage(null);
    }
  }, [selectedPost]);

  useEffect(() => {
    if (!selectedPost || collapsedThreadIds.length > 0) return;
    const initialCollapsed = threadedComments.roots
      .filter((comment) => (threadedComments.repliesByParent.get(comment.id)?.length ?? 0) > 0)
      .map((comment) => comment.id);
    if (initialCollapsed.length > 0) {
      setCollapsedThreadIds(initialCollapsed);
    }
  }, [collapsedThreadIds.length, selectedPost, threadedComments]);

  const canWrite = actor?.role === 'admin' || actor?.role === 'manager';
  const canManagePost = (post?: BoardPost | null) =>
    actor?.role === 'admin' || (actor?.role === 'manager' && !!post?.isMine);

  const canManageSelected =
    actor?.role === 'admin'
    || (actor?.role === 'manager' && (detailData?.post?.isMine ?? selectedPost?.isMine));
  const canShowPostActions = actor?.role === 'admin' || actor?.role === 'manager';

  const openActionSheet = () => {
    if (!canManageSelected) {
      Alert.alert('권한 없음', '본인 게시글만 수정하거나 삭제할 수 있습니다.');
      return;
    }
    setShowActionSheet(true);
  };

  const closeActionSheet = () => {
    setShowActionSheet(false);
  };

  const handleWrite = () => {
    if (!canWrite) {
      Alert.alert('접근 불가', '관리자만 게시글을 작성할 수 있습니다.');
      return;
    }
    router.push('/admin-board');
  };

  const handleEdit = (post: BoardPost) => {
    if (!canManagePost(post)) {
      Alert.alert('권한 없음', '본인 게시글만 수정할 수 있습니다.');
      return;
    }
    router.push({ pathname: '/admin-board', params: { postId: post.id } });
  };

  const handleDelete = (post: BoardPost) => {
    if (!canManagePost(post)) {
      Alert.alert('권한 없음', '본인 게시글만 삭제할 수 있습니다.');
      return;
    }
    Alert.alert('게시글 삭제', `"${safeText(post.title)}" 게시글을 삭제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => deletePostMutation.mutate(post.id),
      },
    ]);
  };

  const filteredPosts = useMemo(() => {
    if (!posts) return [];
    if (!searchQuery.trim()) return posts;
    const q = searchQuery.toLowerCase();
    return posts.filter((p) => (
      safeText(p.title).toLowerCase().includes(q)
      || safeText(p.contentPreview).toLowerCase().includes(q)
    ));
  }, [posts, searchQuery]);

  const getAttachmentSummary = (attachments: BoardPost['attachments']) => {
    if (!attachments || attachments.length === 0) return null;
    const imageCount = attachments.filter((item) => item.fileType === 'image').length;
    const fileCount = attachments.filter((item) => item.fileType === 'file').length;
    const parts = [];
    if (imageCount) parts.push(`이미지 ${imageCount}`);
    if (fileCount) parts.push(`파일 ${fileCount}`);
    return parts.join(' · ');
  };

  const contentBottomPadding = ((actor?.role === 'admin' || actor?.role === 'manager') ? 160 : 96) + (insets.bottom || 0);
  const modalHeaderPaddingTop = Math.max(insets.top - 12, 8);
  const modalTopGap = Math.max(insets.top + 12, 24);
  const fabBottom = Math.max(insets.bottom, 12) + bottomNavHeight + 12;
  const commentBarInset = 96;

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!selectedPost) return;
      event.preventDefault();
      animateCloseModal();
    });
    return unsubscribe;
  }, [animateCloseModal, navigation, selectedPost]);

  useEffect(() => {
    if (!selectedPost) {
      setShowActionSheet(false);
    }
  }, [selectedPost]);

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
      <View style={styles.pageTitleWrap}>
        <Text style={styles.title}>게시판 관리</Text>
        <Text style={styles.subtitle}>게시글 확인 및 관리</Text>
      </View>

      {isManager && (
        <View style={styles.readOnlyBanner}>
          <Feather name="alert-circle" size={16} color="#f59e0b" />
          <Text style={styles.readOnlyText}>본부장은 본인 게시글만 수정/삭제할 수 있습니다.</Text>
        </View>
      )}

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
            placeholder="게시글 검색..."
            placeholderTextColor={TEXT_MUTED}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View style={styles.container}>
          {isLoading && !refreshing && (
            <>
              <CardSkeleton showHeader lines={3} />
              <CardSkeleton showHeader lines={4} />
              <CardSkeleton showHeader lines={3} />
            </>
          )}

          {isError && (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={32} color="#EF4444" />
              <Text style={styles.errorText}>게시글을 불러오지 못했습니다.</Text>
            </View>
          )}

          {!isLoading && filteredPosts.length === 0 && (
            <View style={styles.emptyBox}>
              <Feather name="inbox" size={40} color={BORDER} />
              <Text style={styles.emptyText}>등록된 게시글이 없습니다.</Text>
            </View>
          )}

          {filteredPosts.map((post, index) => {
            const categoryName = resolveCategoryName(post.categoryId);
            const categoryTheme = getCategoryTheme(categoryName);

            return (
              <MotiView
                key={post.id}
                from={{ opacity: 0, translateY: 10 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ delay: index * 50 }}
              >
                <Pressable
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelectedPost(post)}
                >
                {/* 게시글 헤더 */}
                <View style={styles.cardHeader}>
                  <View style={styles.authorBadge}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{getInitial(post.authorName)}</Text>
                    </View>
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.authorName}>{safeText(post.authorName)}</Text>
                        <View style={[styles.roleBadge, { backgroundColor: post.authorRole === 'admin' ? '#dbeafe' : '#e9d5ff' }]}>
                          <Text style={[styles.roleText, { color: post.authorRole === 'admin' ? '#2563eb' : '#9333ea' }]}>
                            {post.authorRole === 'admin' ? '관리자' : '본부장'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.date}>{new Date(post.createdAt).toLocaleDateString('ko-KR')}</Text>
                    </View>
                  </View>
                </View>

                {/* 게시글 내용 */}
                <View style={styles.titleRow}>
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
                    <Text style={[styles.categoryBadgeText, { color: categoryTheme.textColor }]}>
                      {categoryName}
                    </Text>
                  </View>
                  <Text style={styles.postTitleInline}>
                    {safeText(post.title)}
                  </Text>
                </View>
                <LinkifiedSelectableText text={post.contentPreview} style={styles.postContent} numberOfLines={2} />

                {post.attachments && post.attachments.length > 0 && (
                  <View style={styles.attachmentPreview}>
                    <View style={styles.attachmentPreviewImages}>
                      {post.attachments
                        .filter((item) => item.fileType === 'image')
                        .slice(0, 4)
                        .map((item) => (
                          <AttachmentPreviewThumb key={item.id} uri={item.signedUrl} />
                        ))}
                    </View>
                    <View style={styles.attachmentMeta}>
                      <Feather name="paperclip" size={14} color={TEXT_MUTED} />
                      <Text style={styles.attachmentMetaText}>
                        {getAttachmentSummary(post.attachments)}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.divider} />

                {/* 반응 및 댓글 요약 */}
                <View style={styles.footer}>
                  <View style={styles.reactionRow}>
                    {DEFAULT_REACTIONS.map((reaction) => (
                      <View key={reaction.id} style={styles.reactionItem}>
                        <Feather name={reaction.icon as any} size={14} color={reaction.color} />
                        <Text style={[styles.reactionCount, { color: reaction.color }]}>
                          {post.reactions?.[reaction.id as keyof typeof post.reactions] ?? 0}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.footerMeta}>
                    <View style={styles.commentInfo}>
                      <Feather name="eye" size={14} color={TEXT_MUTED} />
                      <Text style={styles.commentCount}>{post.stats.viewCount ?? 0}</Text>
                    </View>
                    <View style={styles.commentInfo}>
                      <Feather name="message-circle" size={14} color={TEXT_MUTED} />
                      <Text style={styles.commentCount}>{post.stats.commentCount}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.adminActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      pressed && { opacity: 0.7 },
                      !canManagePost(post) && styles.actionButtonDisabled,
                    ]}
                    onPress={() => handleEdit(post)}
                    disabled={!canManagePost(post)}
                  >
                    <Feather name="edit-2" size={14} color={CHARCOAL} />
                    <Text style={styles.actionText}>수정</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      styles.actionDelete,
                      pressed && { opacity: 0.7 },
                      !canManagePost(post) && styles.actionButtonDisabled,
                    ]}
                    onPress={() => handleDelete(post)}
                    disabled={!canManagePost(post)}
                  >
                    <Feather name="trash-2" size={14} color="#ef4444" />
                    <Text style={[styles.actionText, { color: '#ef4444' }]}>삭제</Text>
                  </Pressable>
                </View>
                </Pressable>
              </MotiView>
            );
          })}
        </View>
      </Animated.ScrollView>

      {!selectedPost && (
        <Animated.View style={[styles.fabContainer, { bottom: fabBottom }, fabAnimatedStyle, fabShiftStyle]}>
          <Pressable
            style={({ pressed }) => [
              styles.fabButton,
              pressed && { opacity: 0.9 },
              !canWrite && styles.fabButtonDisabled,
            ]}
            onPress={handleWrite}
            disabled={!canWrite}
          >
            <Feather name="edit-3" size={18} color="#fff" />
            <Animated.View style={[styles.fabLabelContainer, fabLabelContainerStyle]}>
              <Text style={styles.fabLabel}>글쓰기</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      )}

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
                <View style={[styles.modalHeader, { paddingTop: modalHeaderPaddingTop }]}>
                  <Text style={styles.modalTitle}>게시글 상세</Text>
                  <Pressable onPress={animateCloseModal}>
                    <Feather name="x" size={24} color={CHARCOAL} />
                  </Pressable>
                </View>
              </GestureDetector>
              <KeyboardAwareWrapper
                style={styles.modalBody}
                contentContainerStyle={{ paddingBottom: commentBarInset + insets.bottom, flexGrow: 1 }}
                keyboardShouldPersistTaps="handled"
              >
              {/* 작성자 정보 */}
                <View style={styles.modalAuthor}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{getInitial(modalPost?.authorName)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.authorName}>{safeText(modalPost?.authorName)}</Text>
                      <View style={[styles.roleBadge, { backgroundColor: modalPost?.authorRole === 'admin' ? '#dbeafe' : '#e9d5ff' }]}>
                        <Text style={[styles.roleText, { color: modalPost?.authorRole === 'admin' ? '#2563eb' : '#9333ea' }]}>
                          {modalPost?.authorRole === 'admin' ? '관리자' : '본부장'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.date}>
                      {modalPost?.createdAt
                        ? new Date(modalPost.createdAt).toLocaleDateString('ko-KR', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                        : ''}
                    </Text>
                    <View style={styles.viewMeta}>
                      <Feather name="eye" size={14} color={TEXT_MUTED} />
                      <Text style={styles.viewMetaText}>조회 {modalPost?.viewCount ?? 0}</Text>
                    </View>
                  </View>
                  {canShowPostActions && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.moreButton,
                        !canManageSelected && styles.moreButtonDisabled,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={openActionSheet}
                    >
                      <Feather name="more-vertical" size={20} color={CHARCOAL} />
                    </Pressable>
                  )}
                </View>

              {(() => {
                const categoryName = resolveCategoryName(modalPost?.categoryId);
                const categoryTheme = getCategoryTheme(categoryName);
                return (
                  <View style={styles.modalTitleRow}>
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
                      <Text style={[styles.categoryBadgeText, { color: categoryTheme.textColor }]}>
                        {categoryName}
                      </Text>
                    </View>
                    <Text style={styles.modalPostTitleInline} selectable>
                      {safeText(modalPost?.title)}
                    </Text>
                  </View>
                );
              })()}

              <LinkifiedSelectableText text={modalPost?.content} style={styles.modalPostContent} />

              {modalAttachments.length > 0 && (
                <View style={styles.attachmentSection}>
                  <Text style={styles.sectionTitle}>첨부파일</Text>

                  <View style={styles.attachmentGrid}>
                    {modalAttachmentImages.map((item, index) => (
                        <Pressable
                          key={item.id}
                          style={({ pressed }) => [
                            styles.attachmentGridItem,
                            pressed && { opacity: 0.75 },
                          ]}
                          onPress={() => {
                            setPreviewImage({
                              images: modalAttachmentImages.map((image) => ({ url: image.url, title: image.title })),
                              initialIndex: index,
                            });
                          }}
                        >
                          <Image source={{ uri: item.url }} style={styles.attachmentGridImage} />
                          <Text style={styles.attachmentName} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.attachmentSize}>{formatFileSize(item.fileSize)}</Text>
                        </Pressable>
                    ))}
                  </View>

                  <View style={styles.attachmentList}>
                    {modalAttachments
                      .filter((item) => item.fileType === 'file')
                      .map((item) => (
                        <Pressable
                          key={item.id}
                          style={styles.attachmentItem}
                          onPress={() => {
                            if (item.signedUrl) {
                              Linking.openURL(item.signedUrl);
                            }
                          }}
                        >
                          <View style={styles.attachmentIcon}>
                            <Feather name="file-text" size={16} color={HANWHA_ORANGE} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.attachmentName}>{safeDecodeFileName(item.fileName)}</Text>
                            <Text style={styles.attachmentSize}>{formatFileSize(item.fileSize)}</Text>
                          </View>
                          <Feather name="download" size={16} color={TEXT_MUTED} />
                        </Pressable>
                      ))}
                  </View>
                </View>
              )}

              <View style={styles.divider} />

              {/* 감정 표현 버튼 */}
              <View style={styles.reactionsSection}>
                <Text style={styles.sectionTitle}>반응 남기기</Text>
                <ReactionPicker
                  reactions={DEFAULT_REACTIONS}
                  onReact={(reactionId) => addReactionMutation.mutate({ postId: selectedPost.id, reactionType: reactionId as ReactionKey })}
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

              </KeyboardAwareWrapper>
              {/* 댓글 작성 */}
              <View style={[styles.commentBar, { paddingBottom: Math.max(insets.bottom, 12) + keyboardPadding }]}>
                {replyTarget && (
                  <View style={styles.replyBanner}>
                    <Text style={styles.replyBannerText}>{replyTarget.authorName}님에게 답글</Text>
                    <Pressable
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
                  <Pressable
                    style={[styles.commentSubmitButton, !commentText.trim() && { opacity: 0.5 }]}
                    onPress={handleAddComment}
                    disabled={!commentText.trim() || addCommentMutation.isPending}
                  >
                    <Feather name="send" size={18} color="#fff" />
                  </Pressable>
                </View>
              </View>

              {showActionSheet && selectedPost && canManageSelected && (
                <View style={styles.actionSheetOverlay}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={closeActionSheet} />
                  <View style={[styles.actionSheet, { paddingBottom: 24 + insets.bottom }]}>
                    <Text style={styles.actionSheetTitle}>게시글 관리</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionSheetButton,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => {
                        closeActionSheet();
                        handleEdit(selectedPost);
                      }}
                    >
                      <Feather name="edit-2" size={16} color={CHARCOAL} />
                      <Text style={styles.actionSheetText}>수정</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionSheetButton,
                        pressed && { opacity: 0.6 },
                      ]}
                      onPress={() => {
                        closeActionSheet();
                        handleDelete(selectedPost);
                      }}
                    >
                      <Feather name="trash-2" size={16} color="#ef4444" />
                      <Text style={[styles.actionSheetText, { color: '#ef4444' }]}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </Animated.View>
        </View>
      )}

      <ImagePreviewModal
        visible={!!previewImage}
        images={previewImage?.images ?? []}
        initialIndex={previewImage?.initialIndex ?? 0}
        onClose={closePreviewImage}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  pageTitleWrap: { marginHorizontal: 20, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: CHARCOAL },
  subtitle: { fontSize: 13, color: TEXT_MUTED, marginTop: 4 },
  fabContainer: {
    position: 'absolute',
    right: 20,
    height: 48,
    borderRadius: 24,
    ...CARD_SHADOW,
    zIndex: 20,
  },
  fabButton: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    paddingHorizontal: 12,
    borderRadius: 24,
    backgroundColor: HANWHA_ORANGE,
    overflow: 'hidden',
  },
  fabButtonDisabled: { opacity: 0.6 },
  fabLabelContainer: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: '#fef3c7',
  },
  readOnlyText: { fontSize: 12, fontWeight: '600', color: '#92400e' },
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
    paddingRight: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 15,
    color: CHARCOAL,
  },
  container: { padding: 24, gap: 16, paddingTop: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    ...CARD_SHADOW,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  authorBadge: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: HANWHA_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  authorName: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  roleText: { fontSize: 11, fontWeight: '600' },
  date: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  viewMeta: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewMetaText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  postTitleInline: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: CHARCOAL,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
  },
  categoryBadgeInline: {
    marginBottom: 0,
    flexShrink: 0,
  },
  categoryBadgeText: { fontSize: 11, fontWeight: '700' },
  postContent: { fontSize: 14, color: TEXT_MUTED, lineHeight: 20 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },
  attachmentPreview: {
    marginTop: 10,
    gap: 8,
  },
  attachmentPreviewImages: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  attachmentThumb: {
    width: 120,
    height: 120,
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
  attachmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachmentMetaText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  reactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commentInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentCount: { fontSize: 13, color: TEXT_MUTED, fontWeight: '600' },
  adminActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  actionDelete: { borderColor: '#fecaca', backgroundColor: '#fff' },
  actionText: { fontSize: 12, fontWeight: '600', color: CHARCOAL },
  actionButtonDisabled: { opacity: 0.5 },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: TEXT_MUTED },
  errorText: { fontSize: 15, color: '#EF4444' },

  // Bottom Nav
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    ...CARD_SHADOW,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  bottomNavIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 22,
    backgroundColor: 'rgba(243,111,33,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(243,111,33,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIconWrapActive: {
    backgroundColor: HANWHA_ORANGE,
    borderColor: HANWHA_ORANGE,
  },
  bottomNavLabel: { fontSize: 13, color: TEXT_MUTED, fontWeight: '700' },
  bottomNavLabelActive: { color: CHARCOAL },

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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: '#fff',
  },
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonDisabled: { opacity: 0.4 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL },
  modalBody: { paddingHorizontal: 24, paddingVertical: 14 },
  modalAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  modalPostTitleInline: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: CHARCOAL,
    lineHeight: 28,
  },
  modalPostContent: {
    fontSize: 15,
    color: CHARCOAL,
    lineHeight: 24,
  },
  reactionsSection: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 12,
  },
  attachmentSection: { marginBottom: 20, gap: 10 },
  attachmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  attachmentGridItem: {
    width: '48%',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fff',
    gap: 6,
  },
  attachmentGridImage: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  attachmentGridPlaceholder: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentList: { gap: 10 },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  attachmentIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(243,111,33,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: { fontSize: 13, fontWeight: '600', color: CHARCOAL },
  attachmentSize: { fontSize: 12, color: TEXT_MUTED },
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
    width: 28,
    height: 28,
    borderRadius: 14,
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
    width: 24,
    height: 24,
    borderRadius: 12,
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
  actionSheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  actionSheet: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 12,
  },
  actionSheetTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 6,
  },
  actionSheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
  },
  actionSheetText: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
});

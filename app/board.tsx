import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
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
  ScrollView,
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

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { CardSkeleton } from '@/components/LoadingSkeleton';
import { DEFAULT_REACTIONS, ReactionPicker } from '@/components/ReactionPicker';
import { RefreshButton } from '@/components/RefreshButton';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import {
  BoardDetail,
  BoardListItem,
  BoardListParams,
  buildBoardActor,
  createBoardComment,
  deleteBoardComment,
  fetchBoardCategories,
  fetchBoardDetail,
  fetchBoardList,
  formatFileSize,
  logBoardError,
  toggleBoardReaction,
  toggleCommentLike,
  updateBoardComment
} from '@/lib/board-api';
import { ANIMATION } from '@/lib/theme';

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
  previousList?: { items: BoardPost[]; nextCursor?: string | null };
};
type CommentLikeMutationContext = {
  previousDetail?: BoardDetail;
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

export default function BoardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { role, displayName, residentId, readOnly } = useSession();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardPadding = useKeyboardPadding();
  const screenHeight = Dimensions.get('window').height;

  const actor = useMemo(
    () => buildBoardActor({ role, residentId, displayName, readOnly }),
    [displayName, readOnly, residentId, role],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BoardPost | null>(null);
  const [commentText, setCommentText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<BoardListParams['sort']>('created');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<string[]>([]);
  const [isThreadInitialized, setIsThreadInitialized] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    authorName: string;
    parentId: string;
  } | null>(null);

  // 정렬 옵션 레이블
  const sortLabels: Record<NonNullable<BoardListParams['sort']>, string> = {
    created: '최신순',
    latest: '업데이트순',
    comments: '댓글많은순',
    reactions: '반응많은순',
  };

  // Scroll animation for bottom nav
  const lastScrollY = useSharedValue(0);
  const bottomNavTranslateY = useSharedValue(0);
  const modalTranslateY = useSharedValue(0);
  const closeModal = useCallback(() => setSelectedPost(null), []);
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

  const { data: listData, isLoading, isError, refetch } = useQuery({
    queryKey: ['board-posts', actor?.role, actor?.residentId, selectedCategoryId, sortOption, searchQuery],
    queryFn: () => {
      if (!actor) return Promise.resolve({ items: [], nextCursor: null });
      return fetchBoardList(actor, {
        limit: 20,
        categoryId: selectedCategoryId ?? undefined,
        sort: sortOption,
        search: searchQuery || undefined,
      });
    },
    enabled: !!actor,
  });

  const { data: detailData } = useQuery({
    queryKey: ['board-detail', selectedPostId],
    queryFn: () => {
      if (!actor || !selectedPostId) return Promise.resolve(null as unknown as BoardDetail);
      return fetchBoardDetail(actor, selectedPostId);
    },
    enabled: !!actor && !!selectedPostId,
  });

  const posts = useMemo(() => listData?.items ?? [], [listData]);
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
    }
    : null);
  const modalAttachments = detailData?.attachments ?? [];
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
  const modalReactionCounts = {
    like: modalReactions.like,
    heart: modalReactions.heart,
    check: modalReactions.check,
    smile: modalReactions.smile,
  };
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
      const listKey = ['board-posts', actor.role, actor.residentId];

      await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: listKey });

      const previousDetail = queryClient.getQueryData<BoardDetail>(detailKey);
      const previousList = queryClient.getQueryData<{ items: BoardPost[]; nextCursor?: string | null }>(listKey);
      const currentCounts = buildReactionCounts(previousDetail?.reactions ?? modalReactions);
      const currentMyReaction = (previousDetail?.reactions?.myReaction ?? modalReactions.myReaction ?? null) as ReactionKey | null;
      const { nextCounts, nextMyReaction, delta } = applyReactionUpdate(currentCounts, currentMyReaction, reactionType);

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

      if (previousList) {
        queryClient.setQueryData(listKey, {
          ...previousList,
          items: previousList.items.map((item) => (
            item.id === postId
              ? {
                ...item,
                reactions: { ...nextCounts },
                stats: {
                  ...item.stats,
                  reactionCount: Math.max(0, item.stats.reactionCount + delta),
                },
              }
              : item
          )),
        });
      }

      setSelectedPost((prev) => {
        if (!prev || prev.id !== postId) return prev;
        return {
          ...prev,
          reactions: { ...nextCounts },
          stats: {
            ...prev.stats,
            reactionCount: Math.max(0, prev.stats.reactionCount + delta),
          },
        };
      });

      return { previousDetail, previousList };
    },
    onError: (error, variables, context) => {
      const detailKey = ['board-detail', variables.postId];
      const listKey = actor ? ['board-posts', actor.role, actor.residentId] : ['board-posts'];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      if (context?.previousList) {
        queryClient.setQueryData(listKey, context.previousList);
      }
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

  const handleAddComment = () => {
    if (!selectedPost || !actor) return;
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
          setEditingCommentText(comment.content);
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
            <Text style={styles.avatarTextSmall}>{comment.authorName.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.commentAuthor}>{comment.authorName}</Text>
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
          <Text style={styles.commentContent}>{comment.content}</Text>
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
      setIsThreadInitialized(false);
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

  // 서버에서 필터링/정렬된 게시글 사용
  const filteredPosts = posts;

  const getAttachmentSummary = (attachments: BoardPost['attachments']) => {
    if (!attachments || attachments.length === 0) return null;
    const imageCount = attachments.filter((item) => item.fileType === 'image').length;
    const fileCount = attachments.filter((item) => item.fileType === 'file').length;
    const parts = [];
    if (imageCount) parts.push(`이미지 ${imageCount}`);
    if (fileCount) parts.push(`파일 ${fileCount}`);
    return parts.join(' · ');
  };

  const contentBottomPadding = (role === 'admin' ? 160 : 96) + (insets.bottom || 0);
  const modalHeaderPaddingTop = Math.max(insets.top - 12, 8);
  const modalTopGap = Math.max(insets.top + 12, 24);
  const commentBarInset = 96;

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
      <View style={[styles.header, { paddingTop: 8 + insets.top }]}>
        <Text style={styles.title}>정보 게시판</Text>
        <RefreshButton onPress={onRefresh} />
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
            placeholder="게시글 검색..."
            placeholderTextColor={TEXT_MUTED}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={() => setSearchQuery(searchInput)}
            returnKeyType="search"
          />
          {searchInput.length > 0 && (
            <Pressable
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChips}>
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
            <Text style={styles.sortButtonText}>{sortLabels[sortOption ?? 'created']}</Text>
            <Feather name="chevron-down" size={14} color={TEXT_MUTED} />
          </Pressable>
        </View>

        {/* 정렬 메뉴 */}
        {showSortMenu && (
          <View style={styles.sortMenu}>
            {(Object.entries(sortLabels) as [NonNullable<BoardListParams['sort']>, string][]).map(([key, label]) => (
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

          {filteredPosts.map((post, index) => (
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
                {/* 고정 게시글 배지 */}
                {post.isPinned && (
                  <View style={styles.pinnedBadge}>
                    <Feather name="bookmark" size={12} color="#fff" />
                    <Text style={styles.pinnedBadgeText}>고정</Text>
                  </View>
                )}

                {/* 게시글 헤더 */}
                <View style={styles.cardHeader}>
                  <View style={styles.authorBadge}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{post.authorName.charAt(0)}</Text>
                    </View>
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.authorName}>{post.authorName}</Text>
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
                <Text style={styles.postTitle} numberOfLines={1}>
                  {post.isPinned && <Feather name="bookmark" size={14} color={HANWHA_ORANGE} />}{' '}
                  {post.title}
                </Text>
                <Text style={styles.postContent} numberOfLines={2}>
                  {post.contentPreview}
                </Text>

                {post.attachments && post.attachments.length > 0 && (
                  <View style={styles.attachmentPreview}>
                    <View style={styles.attachmentPreviewImages}>
                      {post.attachments
                        .filter((item) => item.fileType === 'image')
                        .slice(0, 3)
                        .map((item) => (
                          <View key={item.id} style={styles.attachmentThumb}>
                            {item.signedUrl ? (
                              <Image source={{ uri: item.signedUrl }} style={styles.attachmentThumbImage} />
                            ) : (
                              <View style={styles.attachmentThumbPlaceholder}>
                                <Feather name="image" size={16} color={TEXT_MUTED} />
                              </View>
                            )}
                          </View>
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
                  <View style={styles.commentInfo}>
                    <Feather name="message-circle" size={14} color={TEXT_MUTED} />
                    <Text style={styles.commentCount}>{post.stats.commentCount}</Text>
                  </View>
                </View>
              </Pressable>
            </MotiView>
          ))}
        </View>
      </Animated.ScrollView>

      {/* 하단 네비게이션 바 (스크롤시 사라짐) */}
      <Animated.View
        style={[
          styles.bottomNav,
          { paddingBottom: Math.max(insets.bottom, 12) },
          bottomNavAnimatedStyle,
        ]}
      >
        <Pressable style={styles.bottomNavItem} onPress={() => router.push('/')}>
          <View style={styles.bottomNavIconWrap}>
            <Feather name="home" size={20} color={HANWHA_ORANGE} />
          </View>
          <Text style={styles.bottomNavLabel}>홈</Text>
        </Pressable>

        <Pressable style={styles.bottomNavItem}>
          <View style={[styles.bottomNavIconWrap, styles.bottomNavIconWrapActive]}>
            <Feather name="clipboard" size={20} color="#fff" />
          </View>
          <Text style={[styles.bottomNavLabel, styles.bottomNavLabelActive]}>게시판</Text>
        </Pressable>

        <Pressable style={styles.bottomNavItem} onPress={() => router.push('/notice')}>
          <View style={styles.bottomNavIconWrap}>
            <Feather name="bell" size={20} color={HANWHA_ORANGE} />
          </View>
          <Text style={styles.bottomNavLabel}>공지</Text>
        </Pressable>

        <Pressable style={styles.bottomNavItem} onPress={() => router.push('/settings')}>
          <View style={styles.bottomNavIconWrap}>
            <Feather name="settings" size={20} color={HANWHA_ORANGE} />
          </View>
          <Text style={styles.bottomNavLabel}>설정</Text>
        </Pressable>
      </Animated.View>

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
                    <Text style={styles.avatarText}>{modalPost?.authorName?.charAt(0) ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.authorName}>{modalPost?.authorName ?? ''}</Text>
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
                  </View>
                </View>

                <Text style={styles.modalPostTitle}>{modalPost?.title ?? ''}</Text>
                <Text style={styles.modalPostContent}>{modalPost?.content ?? ''}</Text>

                {modalAttachments.length > 0 && (
                  <View style={styles.attachmentSection}>
                    <Text style={styles.sectionTitle}>첨부파일</Text>

                    <View style={styles.attachmentGrid}>
                      {modalAttachments
                        .filter((item) => item.fileType === 'image')
                        .map((item) => (
                          <View key={item.id} style={styles.attachmentGridItem}>
                            {item.signedUrl ? (
                              <Image source={{ uri: item.signedUrl }} style={styles.attachmentGridImage} />
                            ) : (
                              <View style={styles.attachmentGridPlaceholder}>
                                <Feather name="image" size={18} color={TEXT_MUTED} />
                              </View>
                            )}
                            <Text style={styles.attachmentName} numberOfLines={1}>
                              {item.fileName}
                            </Text>
                            <Text style={styles.attachmentSize}>{formatFileSize(item.fileSize)}</Text>
                          </View>
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
                              <Text style={styles.attachmentName}>{item.fileName}</Text>
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
                    selectedReactions={modalReactions.myReaction ? [modalReactions.myReaction] : []}
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
            </View>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: '#fff',
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
    right: 36,
    padding: 4,
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
  container: { padding: 24, gap: 16, paddingTop: 16 },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: HANWHA_ORANGE,
    marginBottom: 10,
  },
  pinnedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
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
  postTitle: { fontSize: 17, fontWeight: '700', color: CHARCOAL, marginBottom: 6 },
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
    marginTop: 12,
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
  commentInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentCount: { fontSize: 13, color: TEXT_MUTED, fontWeight: '600' },
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
  modalTitle: { fontSize: 18, fontWeight: '700', color: CHARCOAL },
  modalBody: { paddingHorizontal: 24, paddingVertical: 14 },
  modalAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  modalPostTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: CHARCOAL,
    marginBottom: 12,
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
  reactionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    backgroundColor: '#fff',
  },
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
});

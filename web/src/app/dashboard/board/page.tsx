'use client';

import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  FileButton,
  Group,
  Image,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconDotsVertical,
  IconEdit,
  IconHeart,
  IconInfoCircle,
  IconMessage,
  IconMoodSmile,
  IconPaperclip,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconThumbUp,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/hooks/use-session';
import {
  BoardDetail,
  BoardListItem,
  buildBoardActor,
  createBoardComment,
  createBoardPost,
  deleteBoardPost,
  deleteBoardComment,
  fetchBoardDetail,
  fetchBoardList,
  fetchBoardCategories,
  finalizeBoardAttachments,
  formatFileSize,
  signBoardAttachments,
  toggleCommentLike,
  toggleBoardReaction,
  updateBoardComment,
  updateBoardPost,
} from '@/lib/board-api';

// 감정 표현 타입
const REACTION_TYPES = [
  { id: 'like', icon: IconThumbUp, label: '좋아요', color: 'blue' },
  { id: 'heart', icon: IconHeart, label: '하트', color: 'red' },
  { id: 'check', icon: IconCheck, label: '확인', color: 'green' },
  { id: 'smile', icon: IconMoodSmile, label: '웃음', color: 'yellow' },
] as const;
type ReactionKey = (typeof REACTION_TYPES)[number]['id'];
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
type WebAttachment = {
  id: string;
  file: File;
  fileType: 'image' | 'file';
  previewUrl?: string;
};
const MAX_ATTACHMENTS = 5;

export default function BoardPage() {
  const { role, residentId, displayName, isReadOnly } = useSession();
  const queryClient = useQueryClient();
  const actor = useMemo(
    () => buildBoardActor({ role, residentId, displayName, readOnly: isReadOnly }),
    [displayName, isReadOnly, residentId, role],
  );
  const canWrite = actor?.role === 'admin' || actor?.role === 'manager';
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedPost, setSelectedPost] = useState<BoardPost | null>(null);
  const selectedPostId = selectedPost?.id ?? null;
  const [searchQuery, setSearchQuery] = useState('');
  const [newPost, setNewPost] = useState({ title: '', content: '' });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; authorName: string } | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [collapsedThreadIds, setCollapsedThreadIds] = useState<string[]>([]);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const isEditMode = !!editingPostId;
  const [attachments, setAttachments] = useState<WebAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<BoardDetail['attachments']>([]);
  const [didLoadEdit, setDidLoadEdit] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['board-categories', actor?.role, actor?.residentId],
    queryFn: () => {
      if (!actor) return Promise.resolve([]);
      return fetchBoardCategories(actor);
    },
    enabled: !!actor,
  });

  const { data: editDetailData } = useQuery({
    queryKey: ['board-detail', editingPostId, 'edit'],
    queryFn: () => {
      if (!actor || !editingPostId) return Promise.resolve(null as unknown as BoardDetail);
      return fetchBoardDetail(actor, editingPostId);
    },
    enabled: !!actor && !!editingPostId,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  // 초기 카테고리 설정: categoryId가 null이고 categories가 로드되면 첫번째 카테고리 선택
  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  // 수정 모드 데이터 로드
  useEffect(() => {
    if (!editDetailData?.post || !editingPostId || didLoadEdit) return;
    setNewPost({ title: editDetailData.post.title, content: editDetailData.post.content });
    setCategoryId(editDetailData.post.categoryId);
    setExistingAttachments(editDetailData.attachments ?? []);
    setDidLoadEdit(true);
  }, [didLoadEdit, editDetailData, editingPostId]);

  useEffect(() => {
    setDidLoadEdit(false);
    setExistingAttachments([]);
  }, [editingPostId]);

  useEffect(() => {
    if (!selectedPostId) {
      setReplyTarget(null);
      setEditingCommentId(null);
      setEditingCommentText('');
      setCollapsedThreadIds([]);
      return;
    }
    setReplyTarget(null);
    setEditingCommentId(null);
    setEditingCommentText('');
  }, [selectedPostId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { data: listData, isLoading } = useQuery({
    queryKey: ['board-posts', actor?.role, actor?.residentId],
    queryFn: () => {
      if (!actor) return Promise.resolve({ items: [], nextCursor: null });
      return fetchBoardList(actor, { limit: 30 });
    },
    enabled: !!actor,
  });

  const posts = useMemo(() => listData?.items ?? [], [listData?.items]);
  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return posts;
    const q = searchQuery.toLowerCase();
    return posts.filter((post) => post.title.toLowerCase().includes(q) || post.contentPreview.toLowerCase().includes(q));
  }, [posts, searchQuery]);

  const { data: detailData } = useQuery({
    queryKey: ['board-detail', selectedPostId],
    queryFn: () => {
      if (!actor || !selectedPostId) return Promise.resolve(null as unknown as BoardDetail);
      return fetchBoardDetail(actor, selectedPostId);
    },
    enabled: !!actor && !!selectedPostId,
  });

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
  const modalImageAttachments = modalAttachments.filter((file) => file.fileType === 'image' && file.signedUrl);
  const modalFileAttachments = modalAttachments.filter((file) => file.fileType === 'file');
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
  const modalReactionCounts: Record<(typeof REACTION_TYPES)[number]['id'], number> = {
    like: modalReactions.like,
    heart: modalReactions.heart,
    check: modalReactions.check,
    smile: modalReactions.smile,
  };
  const modalComments = useMemo(() => detailData?.comments ?? [], [detailData?.comments]);
  const threadedComments = useMemo(() => {
    const roots: BoardDetail['comments'] = [];
    const repliesByParent = new Map<string, BoardDetail['comments']>();
    modalComments.forEach((comment) => {
      if (!comment.parentId) {
        roots.push(comment);
        return;
      }
      const list = repliesByParent.get(comment.parentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentId, list);
    });
    return { roots, repliesByParent };
  }, [modalComments]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedPostId || modalComments.length === 0) return;
    setCollapsedThreadIds((prev) => {
      if (prev.length > 0) return prev;
      const next = threadedComments.roots
        .filter((comment) => (threadedComments.repliesByParent.get(comment.id) ?? []).length > 0)
        .map((comment) => comment.id);
      return next;
    });
  }, [modalComments, selectedPostId, threadedComments]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const canManagePost = (post?: BoardPost | null) =>
    actor?.role === 'admin' || (actor?.role === 'manager' && !!post?.isMine);
  const handleOpenCreate = () => {
    setEditingPostId(null);
    setNewPost({ title: '', content: '' });
    setCategoryId(categories[0]?.id ?? null);
    setAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setExistingAttachments([]);
    open();
  };
  const handleCloseComposer = () => {
    close();
    setEditingPostId(null);
    setNewPost({ title: '', content: '' });
    setCategoryId(null);
    setAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setExistingAttachments([]);
  };

  const createPostMutation = useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      if (!categoryId) throw new Error('카테고리를 선택해주세요.');
      const { id } = await createBoardPost(actor, {
        categoryId,
        title: newPost.title.trim(),
        content: newPost.content.trim(),
      });
      await uploadAttachments(id);
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      notifications.show({
        title: '게시글 작성 완료',
        message: '게시글이 성공적으로 작성되었습니다.',
        color: 'green',
      });
      setNewPost({ title: '', content: '' });
      setEditingPostId(null);
      setAttachments((prev) => {
        prev.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
      setExistingAttachments([]);
      close();
    },
    onError: (error: Error) => {
      notifications.show({
        title: '작성 실패',
        message: error?.message ?? '게시글 작성에 실패했습니다.',
        color: 'red',
      });
    },
  });

  const updatePostMutation = useMutation({
    mutationFn: async () => {
      if (!actor || !editingPostId) throw new Error('로그인이 필요합니다.');
      if (!categoryId) throw new Error('카테고리를 선택해주세요.');
      await updateBoardPost(actor, {
        postId: editingPostId,
        categoryId,
        title: newPost.title.trim(),
        content: newPost.content.trim(),
      });
      await uploadAttachments(editingPostId);
      return { id: editingPostId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      queryClient.invalidateQueries({ queryKey: ['board-detail', editingPostId] });
      notifications.show({
        title: '게시글 수정 완료',
        message: '게시글이 성공적으로 수정되었습니다.',
        color: 'green',
      });
      setNewPost({ title: '', content: '' });
      setEditingPostId(null);
      setAttachments((prev) => {
        prev.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
      setExistingAttachments([]);
      close();
    },
    onError: (error: Error) => {
      notifications.show({
        title: '수정 실패',
        message: error?.message ?? '게시글 수정에 실패했습니다.',
        color: 'red',
      });
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
      notifications.show({
        title: '게시글 삭제 완료',
        message: '게시글이 삭제되었습니다.',
        color: 'red',
      });
      setSelectedPost(null);
    },
    onError: (error: Error) => {
      notifications.show({
        title: '삭제 실패',
        message: error?.message ?? '게시글 삭제에 실패했습니다.',
        color: 'red',
      });
    },
  });

  const reactionMutation = useMutation<
    { myReaction: ReactionKey | null },
    Error,
    ReactionKey,
    ReactionMutationContext | undefined
  >({
    mutationFn: async (reactionType: ReactionKey) => {
      if (!actor || !selectedPostId) throw new Error('로그인이 필요합니다.');
      return toggleBoardReaction(actor, selectedPostId, reactionType);
    },
    onMutate: async (reactionType) => {
      if (!actor || !selectedPostId) return undefined;

      const detailKey = ['board-detail', selectedPostId];
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
            item.id === selectedPostId
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
        if (!prev || prev.id !== selectedPostId) return prev;
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
    onError: (error: Error, _reactionType, context) => {
      const detailKey = ['board-detail', selectedPostId];
      const listKey = actor ? ['board-posts', actor.role, actor.residentId] : ['board-posts'];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      if (context?.previousList) {
        queryClient.setQueryData(listKey, context.previousList);
      }
      notifications.show({
        title: '오류',
        message: error?.message ?? '반응 처리에 실패했습니다.',
        color: 'red',
      });
    },
    onSuccess: (data) => {
      if (!data || !selectedPostId) return;
      const detailKey = ['board-detail', selectedPostId];
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

  const addCommentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string | null }) => {
      if (!actor || !selectedPostId) throw new Error('로그인이 필요합니다.');
      return createBoardComment(actor, { postId: selectedPostId, content, parentId: parentId ?? undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      setCommentText('');
      setReplyTarget(null);
      notifications.show({
        title: '댓글 작성 완료',
        message: '댓글이 성공적으로 작성되었습니다.',
        color: 'green',
      });
    },
    onError: (error: Error) => {
      notifications.show({
        title: '댓글 실패',
        message: error?.message ?? '댓글 작성에 실패했습니다.',
        color: 'red',
      });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return updateBoardComment(actor, { commentId, content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      setEditingCommentId(null);
      setEditingCommentText('');
      notifications.show({
        title: '댓글 수정 완료',
        message: '댓글이 성공적으로 수정되었습니다.',
        color: 'green',
      });
    },
    onError: (error: Error) => {
      notifications.show({
        title: '댓글 수정 실패',
        message: error?.message ?? '댓글 수정에 실패했습니다.',
        color: 'red',
      });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      if (!actor) throw new Error('로그인이 필요합니다.');
      return deleteBoardComment(actor, commentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board-detail', selectedPostId] });
      queryClient.invalidateQueries({ queryKey: ['board-posts'] });
      notifications.show({
        title: '댓글 삭제 완료',
        message: '댓글이 삭제되었습니다.',
        color: 'red',
      });
    },
    onError: (error: Error) => {
      notifications.show({
        title: '댓글 삭제 실패',
        message: error?.message ?? '댓글 삭제에 실패했습니다.',
        color: 'red',
      });
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
      if (!selectedPostId) return undefined;
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
    onError: (error: Error, _commentId, context) => {
      const detailKey = ['board-detail', selectedPostId];
      if (context?.previousDetail) {
        queryClient.setQueryData(detailKey, context.previousDetail);
      }
      notifications.show({
        title: '오류',
        message: error?.message ?? '좋아요 처리에 실패했습니다.',
        color: 'red',
      });
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

  const appendAttachments = (files: File[] | File | null, fileType: 'image' | 'file') => {
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    const nextItems = list.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      fileType,
      previewUrl: fileType === 'image' ? URL.createObjectURL(file) : undefined,
    }));
    const total = existingAttachments.length + attachments.length + nextItems.length;
    if (total > MAX_ATTACHMENTS) {
      notifications.show({
        title: '첨부 제한',
        message: `최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`,
        color: 'red',
      });
      nextItems.splice(MAX_ATTACHMENTS - existingAttachments.length - attachments.length);
    }
    if (nextItems.length === 0) return;
    setAttachments((prev) => [...prev, ...nextItems]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const uploadAttachments = async (targetPostId: string) => {
    if (!actor || attachments.length === 0) return;
    const signPayload = attachments.map((item) => ({
      fileName: item.file.name,
      mimeType: item.file.type || 'application/octet-stream',
      fileSize: item.file.size,
      fileType: item.fileType,
    }));
    const signed = await signBoardAttachments(actor, targetPostId, signPayload);
    for (let i = 0; i < signed.length; i += 1) {
      const fileItem = attachments[i];
      const upload = signed[i];
      const response = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': fileItem.file.type || 'application/octet-stream',
        },
        body: fileItem.file,
      });
      if (!response.ok) {
        throw new Error(`${fileItem.file.name} 업로드에 실패했습니다.`);
      }
    }
    await finalizeBoardAttachments(
      actor,
      targetPostId,
      attachments.map((item, index) => ({
        storagePath: signed[index].storagePath,
        fileName: item.file.name,
        fileSize: item.file.size,
        mimeType: item.file.type || 'application/octet-stream',
        fileType: item.fileType,
      })),
    );
  };

  const handleCreateOrUpdate = () => {
    if (!newPost.title.trim() || !newPost.content.trim()) {
      notifications.show({
        title: '입력 오류',
        message: '제목과 내용을 모두 입력해주세요.',
        color: 'red',
      });
      return;
    }
    if (!categoryId) {
      notifications.show({
        title: '입력 오류',
        message: '카테고리를 선택해주세요.',
        color: 'red',
      });
      return;
    }
    if (editingPostId) {
      updatePostMutation.mutate();
      return;
    }
    createPostMutation.mutate();
  };

  const handleViewPost = (post: BoardPost) => {
    setSelectedPost(post);
    setCommentText('');
  };

  const handleReaction = (reactionType: ReactionKey) => {
    reactionMutation.mutate(reactionType);
  };

  const handleAddComment = () => {
    if (!commentText.trim()) {
      notifications.show({
        title: '입력 오류',
        message: '댓글 내용을 입력해주세요.',
        color: 'red',
      });
      return;
    }
    addCommentMutation.mutate({ content: commentText.trim(), parentId: replyTarget?.id ?? null });
  };

  const toggleThread = (commentId: string) => {
    setCollapsedThreadIds((prev) => (
      prev.includes(commentId)
        ? prev.filter((id) => id !== commentId)
        : [...prev, commentId]
    ));
  };

  const renderCommentThread = (comment: BoardDetail['comments'][number], depth = 0) => {
    const replies = threadedComments.repliesByParent.get(comment.id) ?? [];
    const isCollapsed = depth === 0 && collapsedThreadIds.includes(comment.id);
    const isEditing = editingCommentId === comment.id;
    const createdLabel = new Date(comment.createdAt).toLocaleDateString('ko-KR');

    return (
      <Stack key={comment.id} gap="xs" style={{ marginLeft: depth * 18 }}>
        <Card withBorder radius="md" padding="md" style={{ background: depth >= 1 ? '#F9FAFB' : '#fff' }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap="sm" align="flex-start" wrap="nowrap">
              <Avatar color={comment.authorRole === 'manager' ? 'grape' : comment.authorRole === 'admin' ? 'blue' : 'orange'} radius="xl" size="sm">
                {comment.authorName.charAt(0)}
              </Avatar>
              <div style={{ flex: 1 }}>
                <Group gap="xs" align="center">
                  <Text size="sm" fw={600}>
                    {comment.authorName}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {comment.authorRole === 'admin' ? '관리자' : comment.authorRole === 'manager' ? '본부장' : 'FC'}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {createdLabel}
                    {comment.editedAt ? ' · 수정됨' : ''}
                  </Text>
                </Group>
              </div>
            </Group>
            {comment.isMine && (
              <Menu shadow="md" width={140}>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray">
                    <IconDotsVertical size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconEdit size={14} />}
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditingCommentText(comment.content);
                    }}
                  >
                    수정
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      const confirmDelete = typeof window !== 'undefined'
                        ? window.confirm('댓글을 삭제하시겠습니까?')
                        : false;
                      if (!confirmDelete) return;
                      deleteCommentMutation.mutate(comment.id);
                    }}
                  >
                    삭제
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>

          {isEditing ? (
            <Stack gap="xs" mt="sm">
              <Textarea
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.currentTarget.value)}
                autosize
                minRows={2}
              />
              <Group justify="flex-end" gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    setEditingCommentId(null);
                    setEditingCommentText('');
                  }}
                >
                  취소
                </Button>
                <Button
                  size="xs"
                  variant="filled"
                  color="orange"
                  onClick={() => {
                    const trimmed = editingCommentText.trim();
                    if (!trimmed) {
                      notifications.show({
                        title: '입력 오류',
                        message: '댓글 내용을 입력해주세요.',
                        color: 'red',
                      });
                      return;
                    }
                    updateCommentMutation.mutate({ commentId: comment.id, content: trimmed });
                  }}
                >
                  수정
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text size="sm" mt="sm">
              {comment.content}
            </Text>
          )}

          <Group justify="space-between" mt="sm">
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setReplyTarget({ id: comment.id, authorName: comment.authorName })}
              >
                답글
              </Button>
            </Group>
            <Group gap="xs">
              <motion.div
                animate={comment.isLiked ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ duration: 0.2 }}
              >
                <ActionIcon
                  variant="subtle"
                  color={comment.isLiked ? 'red' : 'gray'}
                  onClick={() => toggleCommentLikeMutation.mutate(comment.id)}
                >
                  <IconHeart size={16} />
                </ActionIcon>
              </motion.div>
              <Text size="xs" c={comment.isLiked ? 'red' : 'dimmed'}>
                {comment.stats.likeCount}
              </Text>
            </Group>
          </Group>
        </Card>

        {depth === 0 && replies.length > 0 && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => toggleThread(comment.id)}
            style={{ alignSelf: 'flex-start' }}
          >
            {isCollapsed ? `답글 ${replies.length}개 보기` : '답글 접기'}
          </Button>
        )}

        {!isCollapsed && replies.length > 0 && (
          <Stack gap="xs">
            {replies.map((reply) => renderCommentThread(reply, depth + 1))}
          </Stack>
        )}
      </Stack>
    );
  };

  const handleEditPost = (post: BoardPost) => {
    if (!canManagePost(post)) {
      notifications.show({
        title: '권한 없음',
        message: '본인 게시글만 수정할 수 있습니다.',
        color: 'red',
      });
      return;
    }
    setEditingPostId(post.id);
    setAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setNewPost({ title: post.title, content: post.contentPreview });
    open();
  };

  const handleDeletePost = (post: BoardPost) => {
    if (!canManagePost(post)) {
      notifications.show({
        title: '권한 없음',
        message: '본인 게시글만 삭제할 수 있습니다.',
        color: 'red',
      });
      return;
    }
    const confirmDelete = typeof window !== 'undefined'
      ? window.confirm('게시글을 삭제하시겠습니까?')
      : false;
    if (!confirmDelete) return;
    deletePostMutation.mutate(post.id);
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* 헤더 */}
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={1} fw={800} c="dark.8">
              정보 게시판
            </Title>
            <Text c="dimmed" mt={4}>
              본부장과 총무가 공유하는 정보 공간
            </Text>
          </div>

          {canWrite && (
            <Button
              leftSection={<IconPlus size={18} />}
              onClick={handleOpenCreate}
              variant="gradient"
              gradient={{ from: 'orange', to: 'red' }}
              size="md"
              radius="md"
            >
              새 게시글 작성
            </Button>
          )}
        </Group>

        {/* 읽기 전용 모드 알림 */}
        {actor?.role === 'manager' && (
          <Alert
            icon={<IconInfoCircle size={20} />}
            title="관리 권한 안내"
            color="yellow"
            variant="light"
          >
            본부장은 게시글을 작성할 수 있으며, 본인 게시글만 수정/삭제할 수 있습니다.
          </Alert>
        )}

        {/* 검색 바 */}
        <TextInput
          placeholder="게시글 검색..."
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          size="md"
          radius="md"
          styles={{
            input: {
              backgroundColor: 'white',
              border: '1px solid #E5E7EB',
            },
          }}
        />

        {/* 게시글 목록 */}
        <Stack gap="md">
          {isLoading && (
            <Text size="sm" c="dimmed">
              게시글을 불러오는 중입니다...
            </Text>
          )}
          {!isLoading && filteredPosts.length === 0 && (
            <Text size="sm" c="dimmed">
              등록된 게시글이 없습니다.
            </Text>
          )}
          <AnimatePresence>
            {filteredPosts.map((post, index) => {
              const previewImages = (post.attachments ?? [])
                .filter((file) => file.fileType === 'image' && file.signedUrl)
                .slice(0, 3);
              return (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card
                    shadow="sm"
                    padding="lg"
                    radius="md"
                    withBorder
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleViewPost(post)}
                  >
                    <Stack gap="md">
                    {/* 게시글 헤더 */}
                    <Group justify="space-between" align="flex-start">
                      <Group>
                        <Avatar color="orange" radius="xl" size="lg">
                          {post.authorName.charAt(0)}
                        </Avatar>
                        <div>
                          <Group gap="xs" align="center">
                            <Text size="sm" fw={600}>
                              {post.authorName}
                            </Text>
                            <Badge
                              size="xs"
                              variant="light"
                              color={post.authorRole === 'admin' ? 'blue' : 'purple'}
                            >
                              {post.authorRole === 'admin' ? '관리자' : '본부장'}
                            </Badge>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {new Date(post.createdAt).toLocaleDateString('ko-KR', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </div>
                      </Group>

                      {canManagePost(post) && (
                        <Menu shadow="md" width={200}>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray">
                              <IconDotsVertical size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              leftSection={<IconEdit size={14} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditPost(post);
                              }}
                            >
                              수정
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePost(post);
                              }}
                            >
                              삭제
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Group>

                    {/* 게시글 내용 */}
                    <div>
                      <Title order={4} mb="xs">
                        {post.title}
                      </Title>
                      <Text size="sm" c="dimmed" lineClamp={2}>
                        {post.contentPreview}
                      </Text>
                    </div>

                    {previewImages.length > 0 && (
                      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                        {previewImages.map((file) => (
                          <Card key={file.id} withBorder padding="xs" radius="md">
                            <Image
                              src={file.signedUrl}
                              alt={file.fileName}
                              radius="md"
                              height={120}
                              fit="cover"
                            />
                          </Card>
                        ))}
                      </SimpleGrid>
                    )}

                    <Divider />

                    <Group justify="flex-end">
                      <Group gap="xs">
                        <ThemeIcon variant="light" color="gray" size="sm">
                          <IconMessage size={14} />
                        </ThemeIcon>
                        <Text size="sm" c="dimmed">
                          {post.stats.commentCount}개의 댓글
                        </Text>
                      </Group>
                    </Group>
                  </Stack>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </Stack>
      </Stack>

      {/* 게시글 작성 모달 */}
      <Modal
        opened={opened}
        onClose={handleCloseComposer}
        title={<Text fw={700} size="lg">{isEditMode ? '게시글 수정' : '새 게시글 작성'}</Text>}
        size="lg"
        padding="xl"
        radius="md"
        centered
      >
        <Stack gap="md">
          <Select
            label="카테고리"
            placeholder="카테고리를 선택하세요"
            data={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            value={categoryId}
            onChange={setCategoryId}
            searchable
            disabled={!canWrite}
          />
          <TextInput
            label="제목"
            placeholder="게시글 제목을 입력하세요"
            size="md"
            value={newPost.title}
            onChange={(e) => setNewPost({ ...newPost, title: e.currentTarget.value })}
            disabled={!canWrite}
          />

          <Textarea
            label="내용"
            placeholder="게시글 내용을 입력하세요"
            minRows={8}
            autosize
            size="md"
            value={newPost.content}
            onChange={(e) => setNewPost({ ...newPost, content: e.currentTarget.value })}
            disabled={!canWrite}
          />

          <Stack gap="xs">
            <Text size="sm" fw={600}>
              첨부파일
            </Text>
            <Group>
              <FileButton
                accept="image/*"
                multiple
                onChange={(files) => appendAttachments(files, 'image')}
                disabled={!canWrite}
              >
                {(props) => (
                  <Button
                    {...props}
                    variant="light"
                    color="orange"
                    leftSection={<IconPhoto size={16} />}
                  >
                    이미지 추가
                  </Button>
                )}
              </FileButton>
              <FileButton
                multiple
                onChange={(files) => appendAttachments(files, 'file')}
                disabled={!canWrite}
              >
                {(props) => (
                  <Button
                    {...props}
                    variant="light"
                    color="orange"
                    leftSection={<IconPaperclip size={16} />}
                  >
                    파일 추가
                  </Button>
                )}
              </FileButton>
            </Group>

            {existingAttachments.length > 0 && (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  기존 첨부파일
                </Text>
                {existingAttachments.map((file) => (
                  <Card key={file.id} withBorder padding="sm" radius="md">
                    <Group justify="space-between">
                      <Group>
                        <ThemeIcon variant="light" color="orange" size="md">
                          <IconInfoCircle size={16} />
                        </ThemeIcon>
                        <div>
                          <Text size="sm" fw={600}>
                            {file.fileName}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatFileSize(file.fileSize)}
                          </Text>
                        </div>
                      </Group>
                      {file.signedUrl && (
                        <Button
                          variant="subtle"
                          color="orange"
                          size="xs"
                          component="a"
                          href={file.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          다운로드
                        </Button>
                      )}
                    </Group>
                  </Card>
                ))}
              </Stack>
            )}

            {attachments.length > 0 && (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  새로 추가된 첨부파일
                </Text>
                {attachments.map((file) => (
                  <Card key={file.id} withBorder padding="sm" radius="md">
                    <Group justify="space-between">
                      <Group>
                        <ThemeIcon variant="light" color="orange" size="md">
                          {file.fileType === 'image' ? <IconPhoto size={16} /> : <IconPaperclip size={16} />}
                        </ThemeIcon>
                        <div>
                          <Text size="sm" fw={600}>
                            {file.file.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatFileSize(file.file.size)}
                          </Text>
                        </div>
                      </Group>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={() => removeAttachment(file.id)}
                      >
                        <IconX size={16} />
                      </ActionIcon>
                    </Group>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={handleCloseComposer}>
              취소
            </Button>
            <Button
              variant="gradient"
              gradient={{ from: 'orange', to: 'red' }}
              onClick={handleCreateOrUpdate}
              disabled={!canWrite}
              loading={createPostMutation.isPending || updatePostMutation.isPending}
            >
              {isEditMode ? '수정 완료' : '작성 완료'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* 게시글 상세 모달 */}
      <Modal
        opened={!!selectedPostId}
        onClose={() => {
          setSelectedPost(null);
          setCommentText('');
        }}
        title={
          <Group>
            <Avatar color="orange" radius="xl" size="md">
              {modalPost?.authorName?.charAt(0) ?? '?'}
            </Avatar>
            <div>
              <Group gap="xs">
                <Text fw={600}>{modalPost?.authorName ?? ''}</Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={modalPost?.authorRole === 'admin' ? 'blue' : 'purple'}
                >
                  {modalPost?.authorRole === 'admin' ? '관리자' : '본부장'}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
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
            </div>
          </Group>
        }
        size="xl"
        padding="xl"
        radius="md"
        centered
        overlayProps={{ blur: 3 }}
      >
        {modalPost && (
          <Stack gap="xl">
            {/* 게시글 내용 */}
            <div>
              <Title order={3} mb="md">
                {modalPost.title}
              </Title>
              <Text size="md" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {modalPost.content}
              </Text>
            </div>

            {(modalImageAttachments.length > 0 || modalFileAttachments.length > 0) && (
              <>
                <Divider />
                <div>
                  {modalImageAttachments.length > 0 && (
                    <>
                      <Text size="sm" fw={600} mb="md" c="dimmed">
                        이미지
                      </Text>
                      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                        {modalImageAttachments.map((file) => (
                          <Card key={file.id} withBorder padding="xs" radius="md">
                            <Image
                              src={file.signedUrl}
                              alt={file.fileName}
                              radius="md"
                              height={160}
                              fit="cover"
                            />
                            <Text size="xs" mt="xs" c="dimmed">
                              {file.fileName}
                            </Text>
                          </Card>
                        ))}
                      </SimpleGrid>
                    </>
                  )}

                  {modalFileAttachments.length > 0 && (
                    <>
                      <Text size="sm" fw={600} mt={modalImageAttachments.length > 0 ? 'md' : 0} mb="md" c="dimmed">
                        첨부파일
                      </Text>
                      <Stack gap="sm">
                        {modalFileAttachments.map((file) => (
                          <Card key={file.id} withBorder padding="sm" radius="md">
                            <Group justify="space-between">
                              <Group>
                                <ThemeIcon variant="light" color="orange" size="md">
                                  <IconInfoCircle size={16} />
                                </ThemeIcon>
                                <div>
                                  <Text size="sm" fw={600}>
                                    {file.fileName}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {formatFileSize(file.fileSize)}
                                  </Text>
                                </div>
                              </Group>
                              {file.signedUrl && (
                                <Button
                                  variant="light"
                                  color="orange"
                                  size="xs"
                                  component="a"
                                  href={file.signedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  다운로드
                                </Button>
                              )}
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    </>
                  )}
                </div>
              </>
            )}

            <Divider />

            {/* 감정 표현 버튼 */}
            <div>
              <Text size="sm" fw={600} mb="xs" c="dimmed">
                반응 남기기
              </Text>
              <Group gap="xs">
                {REACTION_TYPES.map(({ id, icon: Icon, label, color }) => {
                  const isSelected = modalReactions.myReaction === id;
                  return (
                    <Stack key={id} gap={4} align="center">
                      <Tooltip label={label}>
                        <ActionIcon
                          variant={isSelected ? 'filled' : 'light'}
                          color={color}
                          size="lg"
                          radius="xl"
                          onClick={() => handleReaction(id)}
                        >
                          <Icon size={18} />
                        </ActionIcon>
                      </Tooltip>
                      <Text size="xs" c={isSelected ? color : 'dimmed'}>
                        {modalReactionCounts[id]}
                      </Text>
                    </Stack>
                  );
                })}
              </Group>
            </div>

            <Divider />

            {/* 댓글 섹션 */}
            <div>
              <Text size="sm" fw={600} mb="md" c="dimmed">
                댓글 ({modalComments.length})
              </Text>

              <Stack gap="md" mb="xl">
                {threadedComments.roots.length > 0 ? (
                  threadedComments.roots.map((comment) => renderCommentThread(comment))
                ) : (
                  <Text size="sm" c="dimmed">
                    첫 댓글을 남겨보세요.
                  </Text>
                )}
              </Stack>

              {/* 댓글 작성 */}
              <Stack gap="xs">
                {replyTarget && (
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">
                      {replyTarget.authorName}님에게 답글
                    </Text>
                    <ActionIcon variant="subtle" color="gray" onClick={() => setReplyTarget(null)}>
                      <IconX size={16} />
                    </ActionIcon>
                  </Group>
                )}
                <Textarea
                  placeholder={replyTarget ? '답글을 입력하세요...' : '댓글을 입력하세요...'}
                  minRows={3}
                  value={commentText}
                  onChange={(e) => setCommentText(e.currentTarget.value)}
                />
                <Group justify="flex-end">
                  <Button
                    leftSection={<IconMessage size={16} />}
                    onClick={handleAddComment}
                    variant="filled"
                    color="orange"
                    loading={addCommentMutation.isPending}
                  >
                    댓글 작성
                  </Button>
                </Group>
              </Stack>
            </div>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}

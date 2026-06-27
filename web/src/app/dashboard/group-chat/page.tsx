'use client';

import { classifyGroupChatError, GroupChatRequestError } from '@/lib/group-chat-error';

import { useSession } from '@/hooks/use-session';
import {
  groupChatBootstrap,
  groupChatClearNotice,
  groupChatDeleteMessage,
  groupChatMarkRead,
  groupChatSend,
  groupChatSetMemberSendPermission,
  groupChatSetMuted,
  groupChatSetNotice,
  groupChatSetReaction,
  type GroupChatActor,
  type GroupChatMember,
  type GroupChatMessage,
  type GroupChatMessageType,
  type GroupChatNotice,
  type GroupChatRoom,
} from '@/lib/group-chat-client';
import { supabase } from '@/lib/supabase';
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  FileButton,
  Group,
  Image,
  Loader,
  Menu,
  Paper,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBell,
  IconBellOff,
  IconDotsVertical,
  IconDownload,
  IconFile,
  IconMessageCircle,
  IconPhoto,
  IconPinned,
  IconPinnedOff,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const CHAT_UPLOAD_BUCKET = 'chat-uploads';
const GROUP_CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏'];

function showGroupChatErrorNotification(error: unknown) {
  const userError = classifyGroupChatError(error);
  notifications.show({
    title: userError.title,
    message: userError.message,
    color: userError.color,
  });
}
const POLL_INTERVAL_MS = 10_000;

type UploadResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  url?: string;
  fileName?: string;
  fileSize?: number;
};

function sortMessages(messages: GroupChatMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function newestMessageId(messages: GroupChatMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.id.localeCompare(left.id);
  })[0]?.id ?? null;
}

function isStaffGroupChatActor(actor?: GroupChatActor | null) {
  return actor?.role === 'manager' || actor?.role === 'admin';
}

function safeDecodeFileName(value?: string | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function getMessagePreview(message: GroupChatMessage) {
  if (message.deleted_at) return '삭제된 메시지';
  if (message.message_type === 'image') return '사진';
  if (message.message_type === 'file') return safeDecodeFileName(message.file_name) || '파일';
  return message.content;
}

function formatMessageTime(value: string) {
  const date = dayjs(value);
  if (!date.isValid()) return '';
  return date.isSame(dayjs(), 'day') ? date.format('HH:mm') : date.format('MM.DD HH:mm');
}

export default function DashboardGroupChatPage() {
  const { hydrated, role } = useSession();
  const [room, setRoom] = useState<GroupChatRoom | null>(null);
  const [actor, setActor] = useState<GroupChatActor | null>(null);
  const [members, setMembers] = useState<GroupChatMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [notice, setNotice] = useState<GroupChatNotice | null>(null);
  const [muted, setMuted] = useState(false);
  const [canSendMessages, setCanSendMessages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [input, setInput] = useState('');
  const [replyTarget, setReplyTarget] = useState<GroupChatMessage | null>(null);
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [permissionUpdatingIds, setPermissionUpdatingIds] = useState<Set<string>>(new Set());
  const [noticeUpdating, setNoticeUpdating] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const canUsePage = hydrated && (role === 'admin' || role === 'manager');
  const canManageMemberSendPermissions = isStaffGroupChatActor(actor);
  const canManageNotice = isStaffGroupChatActor(actor);
  const inputEnabled = isStaffGroupChatActor(actor) || canSendMessages;

  const scrollToBottom = useCallback(() => {
    window.setTimeout(() => {
      viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
    }, 60);
  }, []);

  const applyBootstrap = useCallback((data: Awaited<ReturnType<typeof groupChatBootstrap>>) => {
    setRoom(data.room);
    setActor(data.actor);
    setMembers(data.members ?? []);
    setMemberCount(data.member_count ?? data.members?.length ?? 0);
    setMessages(sortMessages(data.messages ?? []));
    setNotice(data.notice ?? null);
    setMuted(data.muted === true);
    setCanSendMessages(isStaffGroupChatActor(data.actor) || data.can_send_messages === true);
  }, []);

  const loadGroupChat = useCallback(async (options?: { silent?: boolean; keepScroll?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const data = await groupChatBootstrap(100);
      applyBootstrap(data);
      const topMessageId = newestMessageId(data.messages ?? []);
      if (topMessageId) {
        void groupChatMarkRead(topMessageId);
      }
      if (!options?.keepScroll) scrollToBottom();
    } catch (error) {
      if (!options?.silent) showGroupChatErrorNotification(error);
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap, scrollToBottom]);

  useEffect(() => {
    if (!canUsePage) return;
    void loadGroupChat();
  }, [canUsePage, loadGroupChat]);

  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase
      .channel(`dashboard-group-chat-room-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_chat_messages',
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          void loadGroupChat({ silent: true, keepScroll: true });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadGroupChat, room?.id]);

  useEffect(() => {
    if (!canUsePage) return;

    const intervalId = window.setInterval(() => {
      void loadGroupChat({ silent: true, keepScroll: true });
    }, POLL_INTERVAL_MS);
    const handleFocus = () => {
      void loadGroupChat({ silent: true, keepScroll: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadGroupChat({ silent: true, keepScroll: true });
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canUsePage, loadGroupChat]);

  const filteredMembers = useMemo(() => {
    const keyword = memberSearch.trim().toLowerCase();
    const sorted = [...members].sort((left, right) => {
      const roleOrder = { admin: 0, manager: 1, fc: 2 } as const;
      const roleDiff = roleOrder[left.role] - roleOrder[right.role];
      if (roleDiff !== 0) return roleDiff;
      return String(left.name ?? left.phone).localeCompare(String(right.name ?? right.phone), 'ko-KR');
    });

    if (!keyword) return sorted;
    return sorted.filter((member) => {
      const searchable = [
        member.name,
        member.phone,
        member.headquarters,
        member.appointment_label,
        member.role,
      ].join(' ').toLowerCase();
      return searchable.includes(keyword);
    });
  }, [memberSearch, members]);

  const mergeMessage = useCallback((message: GroupChatMessage) => {
    setMessages((prev) => sortMessages([
      ...prev.filter((row) => row.id !== message.id),
      message,
    ]));
  }, []);

  const handleSend = useCallback(async (content: string, type: GroupChatMessageType = 'text', file?: {
    url?: string | null;
    name?: string | null;
    size?: number | null;
  }) => {
    const trimmed = content.trim();
    if (!inputEnabled || (!trimmed && !file?.url)) return;

    setSending(type === 'text');
    try {
      const result = await groupChatSend({
        content: trimmed || file?.name || '파일',
        messageType: type,
        fileUrl: file?.url ?? null,
        fileName: file?.name ?? null,
        fileSize: file?.size ?? null,
        replyToMessageId: replyTarget?.id ?? null,
      });
      mergeMessage(result.message);
      setInput('');
      setReplyTarget(null);
      void groupChatMarkRead(result.message.id);
      scrollToBottom();
    } catch (error) {
      showGroupChatErrorNotification(error);
    } finally {
      setSending(false);
    }
  }, [inputEnabled, mergeMessage, replyTarget?.id, scrollToBottom]);

  const uploadAndSend = useCallback(async (file: File | null, forcedType?: GroupChatMessageType) => {
    if (!file || !inputEnabled) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucket', CHAT_UPLOAD_BUCKET);

      const response = await fetch('/api/group-chat/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as UploadResponse | null;
      if (!response.ok || !payload?.ok || !payload.url) {
        throw new GroupChatRequestError(payload?.message ?? '파일 업로드에 실패했습니다.', {
          code: payload?.code,
          status: response.status,
          raw: payload,
        });
      }

      const messageType = forcedType ?? (file.type.startsWith('image/') ? 'image' : 'file');
      await handleSend(
        messageType === 'image' ? '사진을 보냈습니다.' : payload.fileName ?? file.name,
        messageType,
        {
          url: payload.url,
          name: payload.fileName ?? file.name,
          size: payload.fileSize ?? file.size,
        },
      );
    } catch (error) {
      showGroupChatErrorNotification(error);
    } finally {
      setUploading(false);
    }
  }, [handleSend, inputEnabled]);

  const handleReaction = useCallback(async (message: GroupChatMessage, reaction: string) => {
    if (message.deleted_at) return;
    try {
      const alreadyReacted = message.reactions?.some((row) => row.reaction === reaction && row.reacted_by_me);
      const result = await groupChatSetReaction(message.id, alreadyReacted ? null : reaction);
      setMessages((prev) => prev.map((row) =>
        row.id === message.id ? { ...row, reactions: result.reactions } : row,
      ));
    } catch (error) {
      showGroupChatErrorNotification(error);
    }
  }, []);

  const handleDelete = useCallback(async (message: GroupChatMessage) => {
    if (message.deleted_at || message.sender_actor_id !== actor?.id) return;
    try {
      const result = await groupChatDeleteMessage(message.id);
      mergeMessage(result.message);
      if (notice?.message_id === message.id) {
        setNotice(null);
      }
    } catch (error) {
      showGroupChatErrorNotification(error);
    }
  }, [actor?.id, mergeMessage, notice?.message_id]);

  const handleNotice = useCallback(async (message: GroupChatMessage) => {
    if (!canManageNotice || message.deleted_at) return;
    setNoticeUpdating(true);
    try {
      if (notice?.message_id === message.id) {
        const result = await groupChatClearNotice();
        setNotice(result.notice);
      } else {
        const result = await groupChatSetNotice(message.id);
        setNotice(result.notice);
      }
    } catch (error) {
      showGroupChatErrorNotification(error);
    } finally {
      setNoticeUpdating(false);
    }
  }, [canManageNotice, notice?.message_id]);

  const handleMuteToggle = useCallback(async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    try {
      const result = await groupChatSetMuted(nextMuted);
      setMuted(result.muted);
    } catch (error) {
      setMuted(!nextMuted);
      showGroupChatErrorNotification(error);
    }
  }, [muted]);

  const handleMemberSendPermissionToggle = useCallback(async (member: GroupChatMember) => {
    if (!canManageMemberSendPermissions || member.role !== 'fc') return;
    const nextCanSend = !member.can_send_messages;
    setPermissionUpdatingIds((prev) => new Set(prev).add(member.actor_id));
    setMembers((prev) => prev.map((row) =>
      row.actor_id === member.actor_id ? { ...row, can_send_messages: nextCanSend } : row,
    ));

    try {
      const result = await groupChatSetMemberSendPermission(member.actor_id, nextCanSend);
      setMembers((prev) => prev.map((row) =>
        row.actor_id === result.member.actor_id ? { ...row, ...result.member } : row,
      ));
    } catch (error) {
      setMembers((prev) => prev.map((row) =>
        row.actor_id === member.actor_id ? { ...row, can_send_messages: member.can_send_messages } : row,
      ));
      showGroupChatErrorNotification(error);
    } finally {
      setPermissionUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(member.actor_id);
        return next;
      });
    }
  }, [canManageMemberSendPermissions]);

  const renderAttachment = (message: GroupChatMessage) => {
    if (message.deleted_at) return null;
    if (message.message_type === 'image' && message.file_url) {
      return (
        <Image
          src={message.file_url}
          alt={safeDecodeFileName(message.file_name) || '첨부 이미지'}
          radius="md"
          maw={320}
          mah={240}
          fit="cover"
          mt={6}
        />
      );
    }

    if (message.message_type === 'file' && message.file_url) {
      const fileName = safeDecodeFileName(message.file_name) || '파일';
      return (
        <Button
          component="a"
          href={message.file_url}
          target="_blank"
          rel="noreferrer"
          variant="light"
          color="gray"
          leftSection={<IconDownload size={16} />}
          mt={6}
        >
          {fileName}
        </Button>
      );
    }

    return null;
  };

  const renderMessage = (message: GroupChatMessage) => {
    const isMe = message.sender_actor_id === actor?.id;
    const deleted = Boolean(message.deleted_at);
    const reactions = message.reactions ?? [];

    return (
      <Group key={message.id} justify={isMe ? 'flex-end' : 'flex-start'} align="flex-end" wrap="nowrap">
        {!isMe ? (
          <Avatar color={message.sender_role === 'fc' ? 'gray' : 'orange'} radius="xl">
            {(message.sender_name ?? message.sender_role).slice(0, 1)}
          </Avatar>
        ) : null}
        <Stack gap={4} maw="72%" align={isMe ? 'flex-end' : 'flex-start'}>
          {!isMe ? (
            <Text size="xs" c="dimmed" fw={700}>{message.sender_name ?? message.sender_phone}</Text>
          ) : null}
          {message.reply_to_message_id ? (
            <Paper withBorder radius="md" px="sm" py={6} bg="gray.0">
              <Text size="xs" fw={700} c={HANWHA_ORANGE}>{message.reply_to_sender_name ?? '메시지'}에게 답장</Text>
              <Text size="xs" c="dimmed" lineClamp={1}>{message.reply_to_content ?? '원문 없음'}</Text>
            </Paper>
          ) : null}
          <Group gap={6} wrap="nowrap" align="flex-end">
            {isMe && message.unread_count > 0 ? (
              <Badge size="xs" color="yellow" variant="light">{message.unread_count}</Badge>
            ) : null}
            <Paper
              radius="lg"
              px="md"
              py="sm"
              bg={deleted ? 'gray.1' : isMe ? HANWHA_ORANGE : 'white'}
              withBorder={!isMe || deleted}
              style={{ borderTopRightRadius: isMe ? 4 : undefined, borderTopLeftRadius: !isMe ? 4 : undefined }}
            >
              <Text size="sm" c={deleted ? 'dimmed' : isMe ? 'white' : CHARCOAL} fw={600} style={{ whiteSpace: 'pre-wrap' }}>
                {deleted ? '삭제된 메시지입니다.' : message.content}
              </Text>
              {renderAttachment(message)}
              {reactions.length > 0 ? (
                <Group gap={4} mt={6}>
                  {reactions.map((reaction) => (
                    <Badge
                      key={reaction.reaction}
                      variant={reaction.reacted_by_me ? 'filled' : 'light'}
                      color={reaction.reacted_by_me ? 'orange' : 'gray'}
                      onClick={() => void handleReaction(message, reaction.reaction)}
                      style={{ cursor: 'pointer' }}
                    >
                      {reaction.reaction} {reaction.count}
                    </Badge>
                  ))}
                </Group>
              ) : null}
            </Paper>
            <Menu shadow="md" width={180} withinPortal position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size="sm" aria-label="메시지 작업">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item disabled={deleted} onClick={() => setReplyTarget(message)}>
                  답장
                </Menu.Item>
                <Menu.Item
                  disabled={deleted}
                  onClick={() => {
                    void navigator.clipboard?.writeText(getMessagePreview(message));
                  }}
                >
                  복사
                </Menu.Item>
                <Menu.Label>반응</Menu.Label>
                <Group gap={4} px="xs" pb="xs">
                  {GROUP_CHAT_REACTIONS.map((reaction) => (
                    <ActionIcon
                      key={reaction}
                      variant="light"
                      color="gray"
                      disabled={deleted}
                      onClick={() => void handleReaction(message, reaction)}
                    >
                      {reaction}
                    </ActionIcon>
                  ))}
                </Group>
                {canManageNotice ? (
                  <Menu.Item
                    disabled={deleted || noticeUpdating}
                    leftSection={notice?.message_id === message.id ? <IconPinnedOff size={14} /> : <IconPinned size={14} />}
                    onClick={() => void handleNotice(message)}
                  >
                    {notice?.message_id === message.id ? '공지 해제' : '공지 등록'}
                  </Menu.Item>
                ) : null}
                {isMe ? (
                  <Menu.Item
                    color="red"
                    disabled={deleted}
                    leftSection={<IconTrash size={14} />}
                    onClick={() => void handleDelete(message)}
                  >
                    삭제
                  </Menu.Item>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Text size="xs" c="dimmed">{formatMessageTime(message.created_at)}</Text>
        </Stack>
      </Group>
    );
  };

  if (!hydrated) return null;

  if (!canUsePage) {
    return (
      <Container size="sm" py="xl">
        <Paper withBorder radius="lg" p="xl">
          <Stack align="center">
            <ThemeIcon color="gray" variant="light" size={56} radius="xl">
              <IconUsers size={28} />
            </ThemeIcon>
            <Text fw={700}>단톡방 접근 권한이 없습니다.</Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="xl" py="xl" h="calc(100vh - 80px)">
      <Group justify="space-between" mb="lg" align="flex-start">
        <div>
          <Title order={2} c={CHARCOAL}>가람PA 단톡방</Title>
          <Text c={MUTED} size="sm">관리자, 본부장, FC가 함께 쓰는 공용 대화방</Text>
        </div>
        <Group>
          <Tooltip label={muted ? '알림 켜기' : '알림 끄기'}>
            <ActionIcon variant="light" color={muted ? 'gray' : 'orange'} size="lg" onClick={handleMuteToggle}>
              {muted ? <IconBellOff size={18} /> : <IconBell size={18} />}
            </ActionIcon>
          </Tooltip>
          <Button variant="light" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => void loadGroupChat()}>
            새로고침
          </Button>
          <Button color="orange" leftSection={<IconUsers size={16} />} onClick={() => setMemberDrawerOpen(true)}>
            대화상대 {memberCount.toLocaleString('ko-KR')}명
          </Button>
        </Group>
      </Group>

      <Paper withBorder radius="lg" h="calc(100% - 72px)" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Group justify="space-between" px="lg" py="md" bg="gray.0">
          <Group gap="sm">
            <ThemeIcon color="orange" radius="xl" variant="light">
              <IconMessageCircle size={18} />
            </ThemeIcon>
            <div>
              <Text fw={800}>{room?.title ?? '가람PA 단톡방'}</Text>
              <Text size="xs" c="dimmed">{actor?.name ?? actor?.phone ?? '계정 확인 중'}</Text>
            </div>
          </Group>
          <Badge color={inputEnabled ? 'green' : 'red'} variant="light">
            {inputEnabled ? '발언 가능' : '발언 제한'}
          </Badge>
        </Group>

        {notice ? (
          <Box px="lg" py="sm" bg="#FFF7ED" style={{ borderTop: '1px solid #FED7AA', borderBottom: '1px solid #FED7AA' }}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <IconPinned size={18} color={HANWHA_ORANGE} />
                <Box style={{ minWidth: 0 }}>
                  <Text size="xs" fw={900} c={HANWHA_ORANGE}>공지</Text>
                  <Text size="sm" fw={700} lineClamp={1}>{getMessagePreview(notice.message)}</Text>
                </Box>
              </Group>
              {canManageNotice ? (
                <ActionIcon variant="subtle" color="orange" loading={noticeUpdating} onClick={() => void groupChatClearNotice().then((result) => setNotice(result.notice))}>
                  <IconX size={16} />
                </ActionIcon>
              ) : null}
            </Group>
          </Box>
        ) : null}

        <Box ref={viewportRef} style={{ flex: 1, overflowY: 'auto', background: '#F8FAFC' }} p="lg">
          {loading && messages.length === 0 ? (
            <Group justify="center" py="xl">
              <Loader color="orange" />
            </Group>
          ) : messages.length === 0 ? (
            <Stack align="center" py="xl" c="dimmed">
              <IconMessageCircle size={36} />
              <Text size="sm">아직 메시지가 없습니다.</Text>
            </Stack>
          ) : (
            <Stack gap="md">
              {messages.map(renderMessage)}
            </Stack>
          )}
        </Box>

        <Box px="lg" py="md" bg="white" style={{ borderTop: '1px solid #E5E7EB' }}>
          {replyTarget ? (
            <Paper withBorder radius="md" px="sm" py={8} mb="sm" bg="gray.0">
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Text size="xs" fw={900} c={HANWHA_ORANGE}>{replyTarget.sender_name ?? '메시지'}에게 답장</Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>{getMessagePreview(replyTarget)}</Text>
                </Box>
                <ActionIcon variant="subtle" color="gray" onClick={() => setReplyTarget(null)}>
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            </Paper>
          ) : null}

          <Group align="flex-end" wrap="nowrap">
            <FileButton onChange={(file) => void uploadAndSend(file, 'image')} accept="image/*">
              {(props) => (
                <ActionIcon {...props} variant="light" color="gray" size="lg" disabled={!inputEnabled || uploading}>
                  <IconPhoto size={18} />
                </ActionIcon>
              )}
            </FileButton>
            <FileButton onChange={(file) => void uploadAndSend(file)} accept="*">
              {(props) => (
                <ActionIcon {...props} variant="light" color="gray" size="lg" disabled={!inputEnabled || uploading}>
                  <IconFile size={18} />
                </ActionIcon>
              )}
            </FileButton>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder={inputEnabled ? '메시지를 입력하세요' : '현재 발언 권한이 없습니다.'}
              minRows={1}
              maxRows={4}
              autosize
              disabled={!inputEnabled || sending || uploading}
              style={{ flex: 1 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(input);
                }
              }}
            />
            <Button
              color="orange"
              leftSection={<IconSend size={16} />}
              loading={sending || uploading}
              disabled={!inputEnabled || !input.trim()}
              onClick={() => void handleSend(input)}
            >
              전송
            </Button>
          </Group>
        </Box>
      </Paper>

      <Drawer
        opened={memberDrawerOpen}
        onClose={() => setMemberDrawerOpen(false)}
        position="right"
        title="대화상대"
        size="md"
      >
        <Stack gap="md">
          <TextInput
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.currentTarget.value)}
            placeholder="이름, 연락처, 본부 검색"
            leftSection={<IconSearch size={16} />}
          />
          <Text size="sm" c="dimmed">{filteredMembers.length.toLocaleString('ko-KR')}명 표시</Text>
          <Stack gap={0}>
            {filteredMembers.map((member) => (
              <Box key={member.actor_id} py="sm">
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Avatar color={member.role === 'fc' ? 'gray' : 'orange'} radius="xl">
                      {(member.name ?? member.role).slice(0, 1)}
                    </Avatar>
                    <Box style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <Text fw={800} lineClamp={1}>{member.name ?? member.phone}</Text>
                        <Badge size="xs" color={member.role === 'fc' ? 'gray' : 'orange'} variant="light">
                          {member.role === 'fc' ? 'FC' : member.role === 'manager' ? '본부장' : '총무'}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {[member.headquarters, member.phone, member.appointment_label].filter(Boolean).join(' · ')}
                      </Text>
                    </Box>
                  </Group>
                  {member.role === 'fc' ? (
                    <Switch
                      checked={member.can_send_messages}
                      disabled={!canManageMemberSendPermissions || permissionUpdatingIds.has(member.actor_id)}
                      onChange={() => void handleMemberSendPermissionToggle(member)}
                      label={member.can_send_messages ? '허용' : '금지'}
                    />
                  ) : (
                    <Badge color="green" variant="light">허용</Badge>
                  )}
                </Group>
                <Divider mt="sm" />
              </Box>
            ))}
          </Stack>
        </Stack>
      </Drawer>
    </Container>
  );
}

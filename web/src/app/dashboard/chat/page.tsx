'use client';

import { fetchPresence } from '@/lib/presence-api';
import {
    formatPresenceLabel,
    getPresenceColor,
    normalizePresencePhone,
    type WebPresenceSnapshot,
} from '@/lib/presence';
import {
    type AdminChatTarget,
} from '@/lib/admin-chat-targets';
import {
    ActionIcon,
    Avatar,
    Badge,
    Box,
    Button,
    Container,
    Group,
    Paper,
    ScrollArea,
    Stack,
    Text,
    TextInput,
    Textarea,
    ThemeIcon,
    Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconMessageCircle,
    IconMessages,
    IconPhone,
    IconRefresh,
    IconSearch,
    IconSend,
    IconTrash,
    IconUser
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/hooks/use-session';
import { NotificationDestinationReady } from '@/components/NotificationDestinationReady';
import {
    formatUnreadReceiptCount,
    getDirectMessageUnreadCount,
} from '@/lib/message-read-receipts';
import {
    notificationFeedbackColor,
    parseNotificationDeliveryFeedback,
} from '@/lib/notification-delivery-feedback';
import { getWebStaffChatActorId } from '@/lib/staff-identity';
import {
    MessengerAttachmentList,
    MessengerAttachmentPicker,
} from '@/components/MessengerAttachments';
import {
  prepareMessengerAttachmentBatch,
  uploadMessengerAttachmentBatch,
  type MessengerAttachmentMetadata,
  type PreparedMessengerAttachmentBatch,
} from '@/lib/messenger-attachment-client';
import { validateMessengerAttachmentCommitResponse } from '@/lib/messenger-attachment-commit';

// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const ROOM_POLL_INTERVAL_MS = 15000;
const CHAT_LIST_REFETCH_INTERVAL_MS = 30000;
const PRESENCE_POLL_INTERVAL_MS = 30_000;
const VISIBLE_PRESENCE_LIMIT = 60;
// --- Types ---
type ChatPreview = AdminChatTarget;

type Message = {
    id: string;
    conversation_id?: string | null;
    content: string;
    sender_id: string;
    receiver_id: string;
    created_at: string;
    is_read: boolean;
    message_type: 'text' | 'image' | 'file';
    file_url?: string | null;
    file_name?: string | null;
    file_size?: number | null;
    attachments?: MessengerAttachmentMetadata[];
    client_message_id?: string;
    send_status?: 'sending' | 'failed' | 'notification-failed' | 'notification-invalid';
};

const sortMessagesByCreatedAt = (rows: Message[]) =>
    [...rows].sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id.localeCompare(b.id);
    });

const areMessagesEqual = (prev: Message[], next: Message[]) => {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
        const a = prev[i];
        const b = next[i];
        if (
            a.id !== b.id
            || a.content !== b.content
            || (a.conversation_id ?? null) !== (b.conversation_id ?? null)
            || a.sender_id !== b.sender_id
            || a.receiver_id !== b.receiver_id
            || a.created_at !== b.created_at
            || a.is_read !== b.is_read
            || (a.file_url ?? null) !== (b.file_url ?? null)
            || (a.file_name ?? null) !== (b.file_name ?? null)
            || JSON.stringify(a.attachments ?? []) !== JSON.stringify(b.attachments ?? [])
            || (a.send_status ?? null) !== (b.send_status ?? null)
        ) {
            return false;
        }
    }
    return true;
};

// --- Page Component ---
export default function ChatPage() {
    const { hydrated, role, residentId, staffType } = useSession();
    const [selectedFc, setSelectedFc] = useState<ChatPreview | null>(null);
    const [keyword, setKeyword] = useState('');
    const [presenceByPhone, setPresenceByPhone] = useState<Record<string, WebPresenceSnapshot>>({});
    const searchParams = useSearchParams();
    const myChatId = useMemo(
        () => getWebStaffChatActorId({ role, residentId, staffType }),
        [residentId, role, staffType],
    );

    const deepLinkedConversationId = useMemo(
        () => (searchParams.get('conversationId') ?? '').trim().toLowerCase(),
        [searchParams],
    );

    // --- Left Panel: Chat List Fetching ---
    const { data: chatList, error: listError, isLoading: isListLoading, refetch: refetchList } = useQuery({
        queryKey: ['admin-chat-list', role, residentId, staffType],
        queryFn: async () => {
            const response = await fetch('/api/admin/chat-list', { cache: 'no-store' });
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                const message
                    = typeof payload?.error === 'string' && payload.error.trim()
                        ? payload.error
                        : 'FC 목록을 불러오지 못했습니다.';
                throw new Error(message);
            }

            return Array.isArray(payload) ? (payload as ChatPreview[]) : [];
        },
        enabled: hydrated && Boolean(role) && Boolean(myChatId),
        placeholderData: (previousData) => previousData,
        refetchInterval: CHAT_LIST_REFETCH_INTERVAL_MS,
    });

    // Filter List
    const filteredList = useMemo(() => (chatList || []).filter((item) => {
        if (!keyword.trim()) return true;
        const q = keyword.trim().toLowerCase();
        return item.name.toLowerCase().includes(q) || item.phone.includes(q);
    }), [chatList, keyword]);
    const deepLinkedSelection = useMemo(() => {
        if (!deepLinkedConversationId) return null;
        return chatList?.find((item) => item.conversation_id === deepLinkedConversationId) ?? null;
    }, [chatList, deepLinkedConversationId]);
    const activeFc = selectedFc ?? deepLinkedSelection;
    const getPresenceSnapshot = useCallback(
        (phone: string | null | undefined) => presenceByPhone[normalizePresencePhone(phone)] ?? null,
        [presenceByPhone],
    );
    const trackedPresencePhones = useMemo(
        () => Array.from(
                new Set(
                    filteredList
                        .slice(0, VISIBLE_PRESENCE_LIMIT)
                        .map((item) => normalizePresencePhone(item.phone))
                        .concat(activeFc ? normalizePresencePhone(activeFc.phone) : [])
                        .filter((phone) => phone.length === 11),
                ),
            ),
        [activeFc, filteredList],
    );
    const loadPresence = useCallback(async (phones = trackedPresencePhones) => {
        if (phones.length === 0) {
            setPresenceByPhone({});
            return;
        }

        const rows = await fetchPresence(phones);
        const nextPresenceByPhone = rows.reduce<Record<string, WebPresenceSnapshot>>((acc, row) => {
            acc[normalizePresencePhone(row.phone)] = row;
            return acc;
        }, {});

        setPresenceByPhone(nextPresenceByPhone);
    }, [trackedPresencePhones]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            void loadPresence(trackedPresencePhones);
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [loadPresence, trackedPresencePhones]);

    useEffect(() => {
        if (trackedPresencePhones.length === 0) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadPresence(trackedPresencePhones);
        }, PRESENCE_POLL_INTERVAL_MS);

        const handleFocus = () => {
            void loadPresence(trackedPresencePhones);
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void loadPresence(trackedPresencePhones);
            }
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [loadPresence, trackedPresencePhones]);

    return (
        <Container size="xl" py="xl" h="calc(100vh - 80px)">
            {deepLinkedConversationId && deepLinkedSelection ? <NotificationDestinationReady /> : null}
            <Group justify="space-between" mb="lg">
                <div>
                    <Title order={2} c={CHARCOAL}>실시간 상담</Title>
                    <Text c={MUTED} size="sm">FC들과 실시간으로 1:1 대화를 나눌 수 있습니다.</Text>
                </div>
            </Group>

            <Paper shadow="sm" radius="lg" withBorder h="80%" style={{ overflow: 'hidden', display: 'flex' }}>

                {/* Left Panel */}
                <Box w="30%" style={{ borderRight: '1px solid #e9ecef', display: 'flex', flexDirection: 'column' }}>
                    <Box p="md" bg="gray.0">
                        <TextInput
                            placeholder="이름/연락처 검색"
                            leftSection={<IconSearch size={16} />}
                            variant="filled"
                            radius="md"
                            value={keyword}
                            onChange={(e) => setKeyword(e.currentTarget.value)}
                        />
                    </Box>
                    <ScrollArea flex={1}>
                        <Stack gap={0}>
                            {isListLoading ? (
                                <Text p="xl" ta="center" size="sm" c="dimmed">목록을 불러오는 중...</Text>
                            ) : listError ? (
                                <Text p="xl" ta="center" size="sm" c="red">
                                    {listError instanceof Error ? listError.message : '대화 목록을 불러오지 못했습니다.'}
                                </Text>
                            ) : filteredList.length > 0 ? (
                                filteredList.map((item) => (
                                    <Box
                                        key={item.fc_id}
                                        p="md"
                                        bg={activeFc?.fc_id === item.fc_id ? 'orange.0' : 'transparent'}
                                        style={{ cursor: 'pointer', borderBottom: '1px solid #f1f3f5', transition: 'background 0.2s' }}
                                        onClick={() => setSelectedFc(item)}
                                        className="hover:bg-gray-50"
                                    >
                                        {(() => {
                                            const presence = getPresenceSnapshot(item.phone);
                                            const presenceLabel = formatPresenceLabel(presence);

                                            return (
                                                <Group align="flex-start" wrap="nowrap">
                                                    <Box pos="relative">
                                                        <Avatar color="gray" radius="xl">
                                                            <IconUser size={18} />
                                                        </Avatar>
                                                        {presenceLabel ? (
                                                            <Box
                                                                w={12}
                                                                h={12}
                                                                pos="absolute"
                                                                right={-1}
                                                                bottom={-1}
                                                                style={{
                                                                    borderRadius: '50%',
                                                                    border: '2px solid white',
                                                                    backgroundColor: getPresenceColor(presence),
                                                                }}
                                                            />
                                                        ) : null}
                                                    </Box>
                                            <Box style={{ flex: 1, minWidth: 0 }}>
                                                <Group justify="space-between" mb={2}>
                                                    <Text size="sm" fw={600} truncate>{item.name}</Text>
                                                    {item.last_time && (
                                                        <Text size="xs" c="dimmed">
                                                            {dayjs(item.last_time).isSame(dayjs(), 'day')
                                                                ? dayjs(item.last_time).format('HH:mm')
                                                                : dayjs(item.last_time).format('MM.DD')}
                                                        </Text>
                                                    )}
                                                </Group>
                                                {presenceLabel ? (
                                                    <Group gap={6} mb={4}>
                                                        <Box
                                                            w={6}
                                                            h={6}
                                                            style={{
                                                                borderRadius: '50%',
                                                                backgroundColor: getPresenceColor(presence),
                                                            }}
                                                        />
                                                        <Text
                                                            size="xs"
                                                            c={presence?.is_online ? '#15803D' : 'dimmed'}
                                                            fw={presence?.is_online ? 600 : 400}
                                                            lineClamp={1}
                                                        >
                                                            {presenceLabel}
                                                        </Text>
                                                    </Group>
                                                ) : null}
                                                <Group justify="space-between">
                                                    <Text size="xs" c={item.unread_count > 0 ? CHARCOAL : 'dimmed'} lineClamp={1} fw={item.unread_count > 0 ? 600 : 400}>
                                                        {item.last_message || '대화가 없습니다.'}
                                                    </Text>
                                                    {item.unread_count > 0 && (
                                                        <Badge size="xs" circle color={HANWHA_ORANGE}>
                                                            {item.unread_count}
                                                        </Badge>
                                                    )}
                                                </Group>
                                            </Box>
                                                </Group>
                                            );
                                        })()}
                                    </Box>
                                ))
                            ) : (
                                <Stack align="center" py="xl" gap="xs">
                                    <IconMessages size={24} color={MUTED} />
                                    <Text size="xs" c="dimmed">대화 목록이 없습니다.</Text>
                                </Stack>
                            )}
                        </Stack>
                    </ScrollArea>
                </Box>

                {/* Right Panel */}
                <Box flex={1} style={{ display: 'flex', flexDirection: 'column' }} bg="white">
                    {activeFc ? (
                        <ChatRoom
                            fc={activeFc}
                            presence={getPresenceSnapshot(activeFc.phone)}
                            onConversationUpdated={() => void refetchList()}
                        />
                    ) : (
                        <Stack align="center" justify="center" h="100%" c="dimmed">
                            <ThemeIcon size={80} radius="xl" color="gray.2" variant="light">
                                <IconMessageCircle size={40} color={MUTED} />
                            </ThemeIcon>
                            <Text size="lg" fw={500}>대화 상대를 선택해주세요</Text>
                            <Text size="sm">좌측 목록에서 상담할 FC를 선택하면 대화창이 열립니다.</Text>
                        </Stack>
                    )}
                </Box>

            </Paper>
        </Container>
    );
}

// --- Chat Room Component ---
function ChatRoom({
    fc,
    presence,
    onConversationUpdated,
}: {
    fc: ChatPreview;
    presence: WebPresenceSnapshot | null;
    onConversationUpdated?: () => void;
}) {
    const { isReadOnly, role, residentId, staffType } = useSession();
    const myChatId = useMemo(
        () => getWebStaffChatActorId({ role, residentId, staffType }),
        [residentId, role, staffType],
    );
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<string | null>(fc.conversation_id ?? null);
    const [inputText, setInputText] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const viewport = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<Message[]>([]);
    const inputTextRef = useRef('');
    const pendingRetryRef = useRef<{ content: string; clientMessageId: string } | null>(null);
    const pendingAttachmentDeliveryRef = useRef<{
        clientMessageId: string;
        batch: PreparedMessengerAttachmentBatch;
        intentIds?: string[];
    } | null>(null);
    const attachmentNotificationReplayRef = useRef(new Map<string, {
        batch: PreparedMessengerAttachmentBatch;
        intentIds: string[];
    }>());

    useEffect(() => {
        inputTextRef.current = inputText;
    }, [inputText]);

    useEffect(() => {
        setConversationId(fc.conversation_id ?? null);
    }, [fc.conversation_id, fc.fc_id]);

    const ensureConversationId = useCallback(async () => {
        if (conversationId) return conversationId;
        const response = await fetch('/api/fc-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            cache: 'no-store',
            body: JSON.stringify({
                type: 'resolve_garamin_direct_conversation',
                target_id: fc.phone,
            }),
        });
        const payload = await response.json().catch(() => null);
        const resolvedId = String(payload?.data?.conversation?.id ?? '').trim().toLowerCase();
        if (!response.ok || !payload?.ok || !resolvedId) {
            throw new Error('direct_conversation_unavailable');
        }
        setConversationId(resolvedId);
        return resolvedId;
    }, [conversationId, fc.phone]);

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            if (viewport.current) {
                viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
            }
        }, 100);
    }, []);

    const applyMessages = useCallback((rows: Message[]) => {
        const preservedRows = rows.map((row) => {
            const existing = messagesRef.current.find((message) => message.id === row.id);
            if (
                existing?.send_status === 'notification-failed'
                || existing?.send_status === 'notification-invalid'
            ) {
                return {
                    ...row,
                    client_message_id: existing.client_message_id,
                    send_status: existing.send_status,
                };
            }
            return row;
        });
        const sorted = sortMessagesByCreatedAt(preservedRows);
        if (areMessagesEqual(messagesRef.current, sorted)) {
            return false;
        }
        messagesRef.current = sorted;
        setMessages(sorted);
        return true;
    }, []);

    const fetchMessages = useCallback(
        async (options?: { scrollOnChange?: boolean; notifyList?: boolean }) => {
            const activeConversationId = await ensureConversationId();
            const response = await fetch('/api/fc-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                cache: 'no-store',
                body: JSON.stringify({
                    type: 'direct_message_list',
                    conversation_id: activeConversationId,
                }),
            });
            const payload = await response.json().catch(() => null);
            const data = payload?.data?.messages;
            if (!response.ok || !payload?.ok || !Array.isArray(data)) return;

            const changed = applyMessages(data as Message[]);
            if (changed && options?.scrollOnChange) {
                scrollToBottom();
            }
            if (changed && options?.notifyList) {
                onConversationUpdated?.();
            }

            await fetch('/api/fc-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type: 'direct_message_mark_read',
                    conversation_id: activeConversationId,
                }),
            });
        },
        [applyMessages, ensureConversationId, onConversationUpdated, scrollToBottom],
    );

    useEffect(() => {
        void fetchMessages({ scrollOnChange: true, notifyList: true });
    }, [fetchMessages]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            void fetchMessages();
        }, ROOM_POLL_INTERVAL_MS);

        const handleFocus = () => {
            void fetchMessages({ notifyList: true });
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void fetchMessages({ notifyList: true });
            }
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [fetchMessages]);

    const handleSendMessage = async () => {
        const trimmed = inputTextRef.current.trim();
        if (!trimmed && selectedFiles.length === 0) return;

        const pendingRetry = pendingRetryRef.current;
        const clientMessageId = pendingRetry?.content === trimmed
            ? pendingRetry.clientMessageId
            : crypto.randomUUID();
        pendingRetryRef.current = null;
        const optimisticId = `optimistic-${clientMessageId}`;
        const optimisticMessage: Message = {
            id: optimisticId,
            conversation_id: fc.conversation_id ?? null,
            sender_id: myChatId,
            receiver_id: fc.phone,
            content: trimmed,
            message_type: 'text',
            is_read: false,
            created_at: new Date().toISOString(),
            send_status: 'sending',
        };

        inputTextRef.current = '';
        setInputText('');
        messagesRef.current = sortMessagesByCreatedAt([...messagesRef.current, optimisticMessage]);
        setMessages(messagesRef.current);
        scrollToBottom();

        try {
            const activeConversationId = await ensureConversationId();
            let attachmentDelivery =
                pendingAttachmentDeliveryRef.current?.clientMessageId === clientMessageId
                    ? pendingAttachmentDeliveryRef.current
                    : null;
            if (!attachmentDelivery && selectedFiles.length > 0) {
                attachmentDelivery = {
                    clientMessageId,
                    batch: await prepareMessengerAttachmentBatch({
                        files: selectedFiles,
                        context: { kind: 'direct', conversationId: activeConversationId },
                        content: trimmed,
                    }),
                };
                pendingAttachmentDeliveryRef.current = attachmentDelivery;
            }
            if (attachmentDelivery && !attachmentDelivery.intentIds) {
                const upload = await uploadMessengerAttachmentBatch(attachmentDelivery.batch);
                if (upload.state === 'committed') {
                    pendingAttachmentDeliveryRef.current = null;
                    setSelectedFiles([]);
                    messagesRef.current = messagesRef.current.filter((message) => message.id !== optimisticId);
                    setMessages(messagesRef.current);
                    void fetchMessages({ scrollOnChange: true, notifyList: true });
                    return;
                }
                attachmentDelivery.intentIds = upload.intentIds;
            }
            const response = await fetch('/api/fc-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type: 'direct_message_send',
                    conversation_id: activeConversationId,
                    client_message_id: clientMessageId,
                    content: trimmed,
                    ...(attachmentDelivery
                        ? {
                            attachment_intent_ids: attachmentDelivery.intentIds,
                            delivery_key: attachmentDelivery.batch.deliveryKey,
                            payload_fingerprint: attachmentDelivery.batch.payloadFingerprint,
                        }
                        : {}),
                }),
            });
            const payload = await response.json().catch(() => null);
            const inserted = payload?.data?.message as Message | undefined;
            if (!response.ok || !payload?.ok || !inserted?.id) {
                throw new Error('direct_message_send_failed');
            }
            if (
                attachmentDelivery
                && !validateMessengerAttachmentCommitResponse({
                    attachmentCommit: payload?.data?.attachmentCommit,
                    message: inserted,
                    expectedAttachmentCount: attachmentDelivery.batch.files.length,
                })
            ) {
                throw new Error('invalid_attachment_commit_response');
            }

            if (inserted) {
                const deliveryFeedback = parseNotificationDeliveryFeedback(payload?.data);
                const insertedMessage: Message = {
                    ...(inserted as Message),
                    client_message_id: clientMessageId,
                    send_status: deliveryFeedback?.state === 'persistence_failed'
                        ? 'notification-failed'
                        : deliveryFeedback?.state === 'invalid_recipient'
                            ? 'notification-invalid'
                            : undefined,
                };
                const next = sortMessagesByCreatedAt([
                    ...messagesRef.current.filter((message) =>
                        message.id !== optimisticId && message.id !== insertedMessage.id,
                    ),
                    insertedMessage,
                ]);
                messagesRef.current = next;
                setMessages(next);
                scrollToBottom();
                onConversationUpdated?.();
                pendingRetryRef.current = null;
                pendingAttachmentDeliveryRef.current = null;
                setSelectedFiles([]);
                if (
                    deliveryFeedback?.state === 'persistence_failed'
                    && attachmentDelivery?.intentIds
                ) {
                    attachmentNotificationReplayRef.current.set(insertedMessage.id, {
                        batch: attachmentDelivery.batch,
                        intentIds: attachmentDelivery.intentIds,
                    });
                } else {
                    attachmentNotificationReplayRef.current.delete(insertedMessage.id);
                }
                if (deliveryFeedback && deliveryFeedback.severity !== 'success') {
                    notifications.show({
                        title: deliveryFeedback.title,
                        message: deliveryFeedback.state === 'persistence_failed'
                            ? '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다. 알림만 다시 시도해 주세요.'
                            : deliveryFeedback.state === 'invalid_recipient'
                                ? '메시지는 전송됐지만 알림 수신자를 확인할 수 없습니다.'
                                : deliveryFeedback.message,
                        color: notificationFeedbackColor(deliveryFeedback),
                    });
                }
            } else {
                messagesRef.current = messagesRef.current.filter((message) => message.id !== optimisticId);
                setMessages(messagesRef.current);
                void fetchMessages({ scrollOnChange: true, notifyList: true });
            }

        } catch (err: unknown) {
            pendingRetryRef.current = { content: trimmed, clientMessageId };
            messagesRef.current = messagesRef.current.filter((message) => message.id !== optimisticId);
            setMessages(messagesRef.current);
            setInputText((current) => {
                if (current.trim()) {
                    inputTextRef.current = current;
                    return current;
                }
                inputTextRef.current = trimmed;
                return trimmed;
            });
            const msg = err instanceof Error ? err.message : '전송 중 오류가 발생했습니다.';
            notifications.show({ title: '전송 실패', message: msg, color: 'red' });
        }
    };

    const handleRetryNotification = async (message: Message) => {
        if (!message.client_message_id) return;
        try {
            const activeConversationId = await ensureConversationId();
            const attachmentReplay = attachmentNotificationReplayRef.current.get(message.id);
            const response = await fetch('/api/fc-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type: 'direct_message_send',
                    conversation_id: activeConversationId,
                    client_message_id: message.client_message_id,
                    content: message.content,
                    ...(attachmentReplay
                        ? {
                            attachment_intent_ids: attachmentReplay.intentIds,
                            delivery_key: attachmentReplay.batch.deliveryKey,
                            payload_fingerprint: attachmentReplay.batch.payloadFingerprint,
                        }
                        : {}),
                }),
            });
            const payload = await response.json().catch(() => null);
            const committed = payload?.data?.message as Message | undefined;
            if (!response.ok || !payload?.ok || !committed?.id) {
                throw new Error('notification_retry_failed');
            }
            const feedback = parseNotificationDeliveryFeedback(payload?.data);
            const next = messagesRef.current.map((item) => (
                item.id === message.id
                    ? {
                        ...item,
                        send_status: feedback?.state === 'persistence_failed'
                            ? 'notification-failed' as const
                            : feedback?.state === 'invalid_recipient'
                                ? 'notification-invalid' as const
                                : undefined,
                    }
                    : item
            ));
            messagesRef.current = next;
            setMessages(next);
            if (feedback?.state !== 'persistence_failed') {
                attachmentNotificationReplayRef.current.delete(message.id);
            }
            notifications.show({
                title: feedback?.state === 'persistence_failed'
                    ? '알림 등록 실패'
                    : feedback?.state === 'invalid_recipient'
                        ? '알림 수신자 확인 필요'
                        : '알림 전송 완료',
                message: feedback?.state === 'persistence_failed'
                    ? '메시지는 이미 전송됐습니다. 알림 등록만 다시 시도해 주세요.'
                    : feedback?.state === 'invalid_recipient'
                        ? '메시지는 이미 전송됐지만 알림 수신자를 확인할 수 없습니다.'
                        : '알림을 보냈습니다.',
                color: feedback
                    ? notificationFeedbackColor(feedback)
                    : 'green',
            });
        } catch {
            notifications.show({
                title: '알림 재시도 실패',
                message: '메시지는 이미 전송됐습니다. 알림 등록만 다시 시도해 주세요.',
                color: 'yellow',
            });
        }
    };

    const handleDeleteMessage = async (messageId: string) => {
        if (isReadOnly) return;
        try {
            const activeConversationId = await ensureConversationId();
            const response = await fetch('/api/fc-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type: 'direct_message_delete',
                    conversation_id: activeConversationId,
                    message_id: messageId,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.ok || payload?.data?.deleted !== true) {
                throw new Error('direct_message_delete_failed');
            }
            applyMessages(messagesRef.current.filter((message) => message.id !== messageId));
            onConversationUpdated?.();
        } catch {
            notifications.show({
                title: '삭제 실패',
                message: '메시지를 삭제하지 못했습니다.',
                color: 'red',
            });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };
    const presenceLabel = formatPresenceLabel(presence);

    return (
        <>
            {/* Header */}
            <Box p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
                <Group justify="space-between">
                    <Group gap="xs">
                        <Box pos="relative">
                            <Avatar color="orange" radius="xl">{fc.name[0]}</Avatar>
                            {presenceLabel ? (
                                <Box
                                    w={12}
                                    h={12}
                                    pos="absolute"
                                    right={-1}
                                    bottom={-1}
                                    style={{
                                        borderRadius: '50%',
                                        border: '2px solid white',
                                        backgroundColor: getPresenceColor(presence),
                                    }}
                                />
                            ) : null}
                        </Box>
                        <div>
                            <Text fw={700} size="md">{fc.name}</Text>
                            <Text size="xs" c="dimmed">{fc.phone}</Text>
                            {presenceLabel ? (
                                <Group gap={6} mt={2}>
                                    <Box
                                        w={6}
                                        h={6}
                                        style={{
                                            borderRadius: '50%',
                                            backgroundColor: getPresenceColor(presence),
                                        }}
                                    />
                                    <Text
                                        size="xs"
                                        c={presence?.is_online ? '#15803D' : 'dimmed'}
                                        fw={presence?.is_online ? 600 : 400}
                                    >
                                        {presenceLabel}
                                    </Text>
                                </Group>
                            ) : null}
                        </div>
                    </Group>
                    <Button variant="subtle" size="xs" leftSection={<IconPhone size={14} />} color="gray">
                        전화 걸기
                    </Button>
                </Group>
            </Box>

            {/* Messages Area */}
            <ScrollArea flex={1} viewportRef={viewport} p="md" bg={HANWHA_ORANGE + '08'}>
                <Stack gap="sm">
                    {messages.map((msg) => {
                        const isMe = msg.sender_id === myChatId;
                        const unreadReceiptText = formatUnreadReceiptCount(
                            getDirectMessageUnreadCount({
                                isOwn: isMe,
                                isRead: msg.is_read,
                            }),
                        );
                        const notificationFailed = msg.send_status === 'notification-failed';
                        const notificationInvalid = msg.send_status === 'notification-invalid';
                        const meta = (
                            <Box
                                style={{
                                    minWidth: 30,
                                    marginBottom: 2,
                                    textAlign: isMe ? 'right' : 'left',
                                }}
                            >
                                {unreadReceiptText ? (
                                    <Text size="xs" c={HANWHA_ORANGE} fw={800} lh={1.1}>
                                        {unreadReceiptText}
                                    </Text>
                                ) : null}
                                <Text size="xs" c="dimmed">
                                    {dayjs(msg.created_at).format('HH:mm')}
                                </Text>
                            </Box>
                        );
                        return (
                            <Group key={msg.id} justify={isMe ? 'flex-end' : 'flex-start'} align="flex-end" gap={4}>
                                {!isMe && (
                                    <Avatar size="sm" radius="xl" color="gray" src={null} />
                                )}
                                {isMe ? meta : null}
                                <Box
                                    style={{
                                        maxWidth: '70%',
                                        padding: '10px 14px',
                                        borderRadius: 16,
                                        borderTopRightRadius: isMe ? 2 : 16,
                                        borderTopLeftRadius: isMe ? 16 : 2,
                                        backgroundColor: isMe ? HANWHA_ORANGE : 'white',
                                        color: isMe ? 'white' : CHARCOAL,
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}
                                >
                                    <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {msg.content}
                                    </Text>
                                    {isMe && (notificationFailed || notificationInvalid) ? (
                                        <Group gap={6} mt={6}>
                                            <Text size="xs" c="white">
                                                {notificationFailed ? '알림 등록 실패' : '알림 수신자 확인 필요'}
                                            </Text>
                                            {notificationFailed ? (
                                                <ActionIcon
                                                    size="sm"
                                                    variant="subtle"
                                                    color="gray.0"
                                                    onClick={() => void handleRetryNotification(msg)}
                                                    aria-label="알림만 재시도"
                                                >
                                                    <IconRefresh size={14} />
                                                </ActionIcon>
                                            ) : null}
                                        </Group>
                                    ) : null}
                                    {msg.file_url && (
                                        <Text size="xs" td="underline" mt={4} component="a" href={msg.file_url} target="_blank" c={isMe ? 'white' : 'blue'}>
                                            {msg.file_name || '파일 보기'}
                                        </Text>
                                    )}
                                    <MessengerAttachmentList
                                        attachments={msg.attachments}
                                        ownMessage={isMe}
                                    />
                                    </Box>
                                    {isMe && !isReadOnly && !msg.id.startsWith('optimistic-') ? (
                                        <ActionIcon
                                            size="xs"
                                            variant="subtle"
                                            color="gray"
                                            aria-label="메시지 삭제"
                                            onClick={() => void handleDeleteMessage(msg.id)}
                                        >
                                            <IconTrash size={13} />
                                        </ActionIcon>
                                    ) : null}
                                    {!isMe ? meta : null}
                            </Group>
                        );
                    })}
                </Stack>
            </ScrollArea>

            {/* Input Area */}
            <Box p="md" bg="white" style={{ borderTop: '1px solid #e9ecef' }}>
                <MessengerAttachmentPicker
                    files={selectedFiles}
                    onChange={(files) => {
                        pendingRetryRef.current = null;
                        pendingAttachmentDeliveryRef.current = null;
                        setSelectedFiles(files);
                    }}
                    disabled={isReadOnly}
                />
                <Group align="flex-end" gap={8}>
                    <Textarea
                        placeholder={isReadOnly ? "본부장 계정은 메시지를 보낼 수 없습니다" : "메시지를 입력하세요 (Enter로 전송)"}
                        autosize
                        minRows={1}
                        maxRows={4}
                            style={{ flex: 1 }}
                            value={inputText}
                            onChange={(e) => {
                                pendingRetryRef.current = null;
                                pendingAttachmentDeliveryRef.current = null;
                                inputTextRef.current = e.currentTarget.value;
                                setInputText(e.currentTarget.value);
                            }}
                            onKeyDown={handleKeyDown}
                            radius="md"
                            disabled={isReadOnly}
                    />
                    <ActionIcon
                        size="lg"
                        color={isReadOnly ? "gray" : "orange"}
                        variant="filled"
                        radius="xl"
                        onClick={handleSendMessage}
                        disabled={isReadOnly || (!inputText.trim() && selectedFiles.length === 0)}
                    >
                        <IconSend size={18} />
                    </ActionIcon>
                </Group>
            </Box>
        </>
    );
}


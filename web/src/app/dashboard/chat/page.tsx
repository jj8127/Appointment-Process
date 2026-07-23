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
import { supabase } from '@/lib/supabase';
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
    IconSearch,
    IconSend,
    IconUser
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/hooks/use-session';
import {
    formatUnreadReceiptCount,
    getDirectMessageUnreadCount,
} from '@/lib/message-read-receipts';
import { getWebStaffChatActorId } from '@/lib/staff-identity';

import { logger } from '@/lib/logger';
import { classifyAdminChatNotificationResult } from '@/lib/admin-chat-notification-result';
// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const ROOM_POLL_INTERVAL_MS = 15000;
const CHAT_LIST_REFETCH_INTERVAL_MS = 30000;
const PRESENCE_POLL_INTERVAL_MS = 30_000;
const VISIBLE_PRESENCE_LIMIT = 60;
const MESSAGE_SELECT_COLUMNS = 'id,content,sender_id,receiver_id,created_at,is_read,message_type,file_url,file_name';
const sanitize = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');

// --- Types ---
type ChatPreview = AdminChatTarget;

type Message = {
    id: string;
    content: string;
    sender_id: string;
    receiver_id: string;
    created_at: string;
    is_read: boolean;
    message_type: 'text' | 'image' | 'file';
    file_url?: string | null;
    file_name?: string | null;
    send_status?: 'sending' | 'failed';
};

type SendFcMessageNotificationInput = {
    fcPhone: string;
    body: string;
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
            || a.sender_id !== b.sender_id
            || a.receiver_id !== b.receiver_id
            || a.created_at !== b.created_at
            || a.is_read !== b.is_read
            || (a.file_url ?? null) !== (b.file_url ?? null)
            || (a.file_name ?? null) !== (b.file_name ?? null)
            || (a.send_status ?? null) !== (b.send_status ?? null)
        ) {
            return false;
        }
    }
    return true;
};

function toRealtimeMessage(row: Partial<Message> | null | undefined): Message | null {
    if (!row) return null;
    const id = String(row.id ?? '').trim();
    const content = String(row.content ?? '');
    const senderId = String(row.sender_id ?? '').trim();
    const receiverId = String(row.receiver_id ?? '').trim();
    const createdAt = String(row.created_at ?? '').trim();
    if (!id || !senderId || !receiverId || !createdAt) return null;

    const messageType =
        row.message_type === 'image' || row.message_type === 'file'
            ? row.message_type
            : 'text';

    return {
        id,
        content,
        sender_id: senderId,
        receiver_id: receiverId,
        created_at: createdAt,
        is_read: row.is_read === true,
        message_type: messageType,
        file_url: row.file_url ?? null,
        file_name: row.file_name ?? null,
    };
}

function isPendingVersionOfMessage(message: Message, incoming: Message) {
    return message.send_status === 'sending'
        && message.sender_id === incoming.sender_id
        && message.receiver_id === incoming.receiver_id
        && message.content === incoming.content;
}

function mergeMessageRows(rows: Message[], incoming: Message) {
    return sortMessagesByCreatedAt([
        ...rows.filter((message) =>
            message.id !== incoming.id && !isPendingVersionOfMessage(message, incoming),
        ),
        incoming,
    ]);
}

function updateMessageRows(rows: Message[], incoming: Message) {
    if (!rows.some((message) => message.id === incoming.id)) {
        return mergeMessageRows(rows, incoming);
    }
    return sortMessagesByCreatedAt(rows.map((message) =>
        message.id === incoming.id ? { ...message, ...incoming } : message,
    ));
}

async function sendFcMessageNotification({
    fcPhone,
    body,
}: SendFcMessageNotificationInput) {
    const resp = await fetch('/api/fc-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
            type: 'message',
            target_role: 'fc',
            target_id: fcPhone,
            message: body,
        }),
    });
    const responseBody: unknown = await resp.json().catch(() => null);
    const result = classifyAdminChatNotificationResult(resp.status, responseBody);
    if (!result.ok) {
        logger.warn('[chat][admin->fc] mobile notification unconfirmed', {
            reason: result.reason,
            status: resp.status,
        });
        throw new Error('mobile_notification_unconfirmed');
    }

    logger.debug('[chat][admin->fc] mobile notification confirmed', {
        sent: result.sent,
        status: resp.status,
    });
}

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

    const deepLinkedTargetId = useMemo(
        () => sanitize(searchParams.get('targetId')),
        [searchParams],
    );
    const deepLinkedTargetName = useMemo(
        () => (searchParams.get('targetName') ?? '').trim(),
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
        if (!deepLinkedTargetId) return null;
        const matched = chatList?.find((item) => item.phone === deepLinkedTargetId);
        if (matched) return matched;
        if (!deepLinkedTargetName) return null;
        return {
            fc_id: deepLinkedTargetId,
            name: deepLinkedTargetName,
            phone: deepLinkedTargetId,
            last_message: null,
            last_time: null,
            unread_count: 0,
        } as ChatPreview;
    }, [chatList, deepLinkedTargetId, deepLinkedTargetName]);
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

    // --- Realtime List Updates ---
    useEffect(() => {
        if (!myChatId) return;

        const channel = supabase
            .channel(`admin-chat-list-${myChatId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'messages' },
                (payload) => {
                    const source = payload.eventType === 'DELETE'
                        ? (payload.old as Partial<Message> | null)
                        : (payload.new as Partial<Message> | null);
                    const senderId = String(source?.sender_id ?? '').trim();
                    const receiverId = String(source?.receiver_id ?? '').trim();
                    if (senderId !== myChatId && receiverId !== myChatId) {
                        return;
                    }
                    refetchList();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [myChatId, refetchList]);

    return (
        <Container size="xl" py="xl" h="calc(100vh - 80px)">
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
    const [inputText, setInputText] = useState('');
    const viewport = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<Message[]>([]);
    const inputTextRef = useRef('');

    useEffect(() => {
        inputTextRef.current = inputText;
    }, [inputText]);

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            if (viewport.current) {
                viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
            }
        }, 100);
    }, []);

    const applyMessages = useCallback((rows: Message[]) => {
        const sorted = sortMessagesByCreatedAt(rows);
        if (areMessagesEqual(messagesRef.current, sorted)) {
            return false;
        }
        messagesRef.current = sorted;
        setMessages(sorted);
        return true;
    }, []);

    const fetchMessages = useCallback(
        async (options?: { scrollOnChange?: boolean; notifyList?: boolean }) => {
            const { data, error } = await supabase
                .from('messages')
                .select(MESSAGE_SELECT_COLUMNS)
                .or(
                    `and(sender_id.eq.${myChatId},receiver_id.eq.${fc.phone}),and(sender_id.eq.${fc.phone},receiver_id.eq.${myChatId})`,
                )
                .order('created_at', { ascending: true });

            if (error || !data) return;

            const changed = applyMessages(data as Message[]);
            if (changed && options?.scrollOnChange) {
                scrollToBottom();
            }
            if (changed && options?.notifyList) {
                onConversationUpdated?.();
            }

            const unreadIds = data.filter((m: Message) => m.sender_id === fc.phone && !m.is_read).map((m: Message) => m.id);
            if (unreadIds.length > 0) {
                await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
                messagesRef.current = messagesRef.current.map((m) =>
                    unreadIds.includes(m.id) ? { ...m, is_read: true } : m,
                );
                setMessages(messagesRef.current);
            }
        },
        [applyMessages, fc.phone, myChatId, onConversationUpdated, scrollToBottom],
    );

    useEffect(() => {
        void fetchMessages({ scrollOnChange: true, notifyList: true });
    }, [fetchMessages]);

    const applyRealtimeMessageChange = useCallback(
        (payload: { eventType: string; new: unknown; old: unknown }) => {
            const rawRow = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<Message> | null;
            const rowId = String(rawRow?.id ?? '').trim();
            const senderId = String(rawRow?.sender_id ?? '').trim();
            const receiverId = String(rawRow?.receiver_id ?? '').trim();
            const knownMessage = Boolean(rowId && messagesRef.current.some((message) => message.id === rowId));
            const isRelated =
                (senderId === myChatId && receiverId === fc.phone) ||
                (senderId === fc.phone && receiverId === myChatId) ||
                (payload.eventType === 'DELETE' && knownMessage);

            if (!isRelated) return 'ignored';

            if (payload.eventType === 'DELETE') {
                if (!rowId) return 'fallback';
                const changed = applyMessages(messagesRef.current.filter((message) => message.id !== rowId));
                if (changed) onConversationUpdated?.();
                return 'applied';
            }

            const incoming = toRealtimeMessage(rawRow);
            if (!incoming) return 'fallback';

            if (payload.eventType === 'INSERT') {
                const changed = applyMessages(mergeMessageRows(messagesRef.current, incoming));
                if (changed) {
                    scrollToBottom();
                    onConversationUpdated?.();
                }
                return 'applied';
            }

            if (payload.eventType === 'UPDATE') {
                const changed = applyMessages(updateMessageRows(messagesRef.current, incoming));
                if (changed) onConversationUpdated?.();
                return 'applied';
            }

            return 'fallback';
        },
        [applyMessages, fc.phone, myChatId, onConversationUpdated, scrollToBottom],
    );

    useEffect(() => {
        const channel = supabase
            .channel(`chat-room-${fc.phone}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'messages' },
                (payload) => {
                    const result = applyRealtimeMessageChange(payload);
                    if (result === 'fallback') {
                        void fetchMessages({ notifyList: true });
                    }
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [applyRealtimeMessageChange, fc.phone, fetchMessages]);

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
        if (!trimmed) return;

        const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const optimisticMessage: Message = {
            id: optimisticId,
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
            const { data: inserted, error } = await supabase
                .from('messages')
                .insert({
                    sender_id: myChatId,
                    receiver_id: fc.phone,
                    content: trimmed,
                    message_type: 'text',
                    is_read: false,
                })
                .select(MESSAGE_SELECT_COLUMNS)
                .single();

            if (error) throw error;

            if (inserted) {
                const insertedMessage = inserted as Message;
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
            } else {
                messagesRef.current = messagesRef.current.filter((message) => message.id !== optimisticId);
                setMessages(messagesRef.current);
                void fetchMessages({ scrollOnChange: true, notifyList: true });
            }

            const notifBody = trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
            try {
                await sendFcMessageNotification({
                    fcPhone: fc.phone,
                    body: notifBody,
                });
            } catch {
                logger.warn('[chat] message notification unconfirmed', {
                    reason: 'delivery_error',
                });
            }
        } catch (err: unknown) {
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
                                    {msg.file_url && (
                                        <Text size="xs" td="underline" mt={4} component="a" href={msg.file_url} target="_blank" c={isMe ? 'white' : 'blue'}>
                                            {msg.file_name || '파일 보기'}
                                        </Text>
                                    )}
                                </Box>
                                {!isMe ? meta : null}
                            </Group>
                        );
                    })}
                </Stack>
            </ScrollArea>

            {/* Input Area */}
            <Box p="md" bg="white" style={{ borderTop: '1px solid #e9ecef' }}>
                <Group align="flex-end" gap={8}>
                    <Textarea
                        placeholder={isReadOnly ? "본부장 계정은 메시지를 보낼 수 없습니다" : "메시지를 입력하세요 (Enter로 전송)"}
                        autosize
                        minRows={1}
                        maxRows={4}
                            style={{ flex: 1 }}
                            value={inputText}
                            onChange={(e) => {
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
                        disabled={isReadOnly || !inputText.trim()}
                    >
                        <IconSend size={18} />
                    </ActionIcon>
                </Group>
            </Box>
        </>
    );
}


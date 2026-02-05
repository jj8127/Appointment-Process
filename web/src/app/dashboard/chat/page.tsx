'use client';

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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/hooks/use-session';

import { logger } from '@/lib/logger';
// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const ADMIN_ID = 'admin';

// --- Types ---
type ChatPreview = {
    fc_id: string;
    name: string;
    phone: string;
    last_message: string | null;
    last_time: string | null;
    unread_count: number;
};

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
};

// --- Page Component ---
export default function ChatPage() {
    const queryClient = useQueryClient();
    const { isReadOnly } = useSession();
    const [selectedFc, setSelectedFc] = useState<ChatPreview | null>(null);
    const [keyword, setKeyword] = useState('');

    // --- Left Panel: Chat List Fetching ---
    const { data: chatList, isLoading: isListLoading, refetch: refetchList } = useQuery({
        queryKey: ['admin-chat-list'],
        queryFn: async () => {
            // 1. Fetch all FCs (only completed signups)
            const { data: fcs, error: fcError } = await supabase
                .from('fc_profiles')
                .select('id,name,phone')
                .eq('signup_completed', true)
                .order('name');
            if (fcError) throw fcError;

            const previews: ChatPreview[] = [];

            // 2. Loop through FCs to get last message and unread count
            // Optimized: Fetch unread messages for admin in bulk if possible, but schema implies row checks.
            // Replicating app logic for consistency (Loop).
            for (const fc of fcs ?? []) {
                // Last Message
                const { data: lastMsgs } = await supabase
                    .from('messages')
                    .select('content,created_at')
                    .or(`and(sender_id.eq.admin,receiver_id.eq.${fc.phone}),and(sender_id.eq.${fc.phone},receiver_id.eq.admin)`)
                    .order('created_at', { ascending: false })
                    .limit(1);

                const lastMsg = lastMsgs?.[0];

                // Unread Count
                const { count } = await supabase
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('sender_id', fc.phone)
                    .eq('receiver_id', ADMIN_ID)
                    .eq('is_read', false);

                // Only include if there is at least one message OR unread count > 0? 
                // Or show all FCs so admin can initiate?
                // App shows only if last message exists? 
                // App admin-messanger.tsx logic: fetches all FCs, then gets last message.
                // It pushes to preview even if last_message is null.

                previews.push({
                    fc_id: fc.id,
                    name: fc.name,
                    phone: fc.phone,
                    last_message: lastMsg?.content ?? null,
                    last_time: lastMsg?.created_at ?? null,
                    unread_count: count ?? 0,
                });
            }

            // Sort by last_time desc
            previews.sort((a, b) => {
                if (!a.last_time) return 1;
                if (!b.last_time) return -1;
                return new Date(b.last_time).getTime() - new Date(a.last_time).getTime();
            });

            return previews;
        },
        refetchInterval: 10000, // Polling list every 10s as backup
    });

    // Filter List
    const filteredList = (chatList || []).filter((item) => {
        if (!keyword.trim()) return true;
        const q = keyword.trim().toLowerCase();
        return item.name.toLowerCase().includes(q) || item.phone.includes(q);
    });

    // --- Realtime List Updates ---
    useEffect(() => {
        const channel = supabase
            .channel('admin-chat-list')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'messages' },
                (payload) => {
                    // If a new message comes in, refetch the list to update order/badge
                    refetchList();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [refetchList]);


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
                            ) : filteredList.length > 0 ? (
                                filteredList.map((item) => (
                                    <Box
                                        key={item.fc_id}
                                        p="md"
                                        bg={selectedFc?.fc_id === item.fc_id ? 'orange.0' : 'transparent'}
                                        style={{ cursor: 'pointer', borderBottom: '1px solid #f1f3f5', transition: 'background 0.2s' }}
                                        onClick={() => setSelectedFc(item)}
                                        className="hover:bg-gray-50"
                                    >
                                        <Group align="flex-start" wrap="nowrap">
                                            <Avatar color="gray" radius="xl">
                                                <IconUser size={18} />
                                            </Avatar>
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
                    {selectedFc ? (
                        <ChatRoom fc={selectedFc} />
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
function ChatRoom({ fc }: { fc: ChatPreview }) {
    const { isReadOnly } = useSession();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const viewport = useRef<HTMLDivElement>(null);
    const [isSending, setIsSending] = useState(false);

    // Fetch Messages
    const fetchMessages = async () => {
        // Query: (sender=admin AND receiver=fc) OR (sender=fc AND receiver=admin)
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${ADMIN_ID},receiver_id.eq.${fc.phone}),and(sender_id.eq.${fc.phone},receiver_id.eq.${ADMIN_ID})`)
            .order('created_at', { ascending: true }); // We want oldest first for chat flow

        if (!error && data) {
            setMessages(data as Message[]);
            scrollToBottom();

            // Mark as read immediately when loaded
            const unreadIds = data.filter((m: Message) => m.sender_id === fc.phone && !m.is_read).map((m: Message) => m.id);
            if (unreadIds.length > 0) {
                await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
            }
        }
    };

    useEffect(() => {
        fetchMessages();

        // Subscribe to this room
        const channel = supabase
            .channel(`chat-room-${fc.phone}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'messages' },
                (payload) => {
                    const newMsg = payload.new as Message;
                    // Check if this message belongs to this conversation
                    const isRelated =
                        (newMsg.sender_id === ADMIN_ID && newMsg.receiver_id === fc.phone) ||
                        (newMsg.sender_id === fc.phone && newMsg.receiver_id === ADMIN_ID);

                    if (isRelated) {
                        if (payload.eventType === 'INSERT') {
                            setMessages((prev) => [...prev, newMsg]);
                            scrollToBottom();
                            // Use canAutoScroll logic if needed? For now force scroll
                            if (newMsg.sender_id === fc.phone) {
                                supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id);
                            }
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fc.phone]);

    const scrollToBottom = () => {
        setTimeout(() => {
            if (viewport.current) {
                viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
            }
        }, 100);
    };

    const handleSendMessage = async () => {
        if (!inputText.trim()) return;
        setIsSending(true);

        try {
            const trimmed = inputText.trim();

            // 1. Insert Message
            const { error } = await supabase.from('messages').insert({
                sender_id: ADMIN_ID,
                receiver_id: fc.phone,
                content: trimmed,
                message_type: 'text',
                is_read: false
            });

            if (error) throw error;

            // 2. Clear input
            setInputText('');

            // 3. Send Notification + Push (with debug logs)
            const notifBody = trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;

            const { error: notifErr } = await supabase.from('notifications').insert({
                title: '상담 답변 알림',
                body: notifBody,
                recipient_role: 'fc',
                resident_id: fc.phone,
                category: 'message'
            });
            if (notifErr) {
                logger.warn('[chat][admin->fc] notifications insert error', notifErr.message);
            } else {
                logger.debug('[chat][admin->fc] notifications insert ok', { resident_id: fc.phone, body: notifBody });
            }

            try {
                const resp = await fetch('/api/fc-notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'message',
                        target_role: 'fc',
                        target_id: fc.phone,
                        message: notifBody,
                        sender_id: ADMIN_ID,
                    }),
                });
                const data = await resp.json().catch(() => null);
                logger.debug('[chat][admin->fc] fc-notify proxy response', {
                    status: resp.status,
                    ok: resp.ok,
                    data,
                });
            } catch (fnErr: any) {
                logger.warn('[chat][admin->fc] fc-notify proxy error', fnErr?.message ?? fnErr);
            }

        } catch (err: any) {
            notifications.show({ title: '전송 실패', message: err.message, color: 'red' });
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <>
            {/* Header */}
            <Box p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
                <Group justify="space-between">
                    <Group gap="xs">
                        <Avatar color="orange" radius="xl">{fc.name[0]}</Avatar>
                        <div>
                            <Text fw={700} size="md">{fc.name}</Text>
                            <Text size="xs" c="dimmed">{fc.phone}</Text>
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
                        const isMe = msg.sender_id === ADMIN_ID;
                        return (
                            <Group key={msg.id} justify={isMe ? 'flex-end' : 'flex-start'} align="flex-end" gap={4}>
                                {!isMe && (
                                    <Avatar size="sm" radius="xl" color="gray" src={null} />
                                )}
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
                                <Text size="xs" c="dimmed" mb={2}>
                                    {dayjs(msg.created_at).format('HH:mm')}
                                </Text>
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
                        onChange={(e) => setInputText(e.currentTarget.value)}
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
                        loading={isSending}
                        disabled={isReadOnly || !inputText.trim()}
                    >
                        <IconSend size={18} />
                    </ActionIcon>
                </Group>
            </Box>
        </>
    );
}


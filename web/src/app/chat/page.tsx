'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
  ActionIcon,
  Avatar,
  Box,
  Container,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconSend, IconUser } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

type Message = {
  id: string;
  content: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
  is_read: boolean;
  message_type?: 'text' | 'image' | 'file';
  file_url?: string | null;
  file_name?: string | null;
};

const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';

function ChatContent() {
  const { role, residentId, hydrated } = useSession();
  const params = useSearchParams();
  const router = useRouter();

  const targetIdParam = params.get('targetId') ?? '';
  const targetNameParam = params.get('targetName') ?? '';

  const myId = useMemo(() => (role === 'admin' ? 'admin' : residentId ?? ''), [role, residentId]);
  const otherId = useMemo(() => (role === 'admin' ? targetIdParam : 'admin'), [role, targetIdParam]);
  const headerTitle = useMemo(
    () => (role === 'admin' ? targetNameParam || otherId || 'FC' : '총무팀'),
    [role, targetNameParam, otherId],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
      }
    });
  };

  // Initial fetch
  useEffect(() => {
    if (!hydrated) return;
    if (!myId || !otherId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`,
        )
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[chat] fetch error', error.message);
        return;
      }
      const filtered = (data ?? []).filter((m) => !deletedIdsRef.current.has(m.id));
      setMessages(filtered);
      scrollToBottom();

      // mark read for incoming
      const unreadIds = filtered.filter((m) => m.sender_id === otherId && !m.is_read).map((m) => m.id);
      if (unreadIds.length > 0) {
        await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
      }
    };

    fetchMessages();
  }, [hydrated, myId, otherId]);

  // Realtime subscription
  useEffect(() => {
    if (!hydrated || !myId || !otherId) return;

    const channel = supabase
      .channel(`chat-${myId}-${otherId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload as any).old?.id;
            if (deletedId) {
              deletedIdsRef.current.add(deletedId);
              setMessages((prev) => prev.filter((m) => m.id !== deletedId));
              return;
            }
          }
          const newMsg = payload.new as Message;
          const related =
            (newMsg.sender_id === myId && newMsg.receiver_id === otherId) ||
            (newMsg.sender_id === otherId && newMsg.receiver_id === myId);
          if (!related) return;

          if (payload.eventType === 'INSERT') {
            setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
            scrollToBottom();
            if (newMsg.sender_id === otherId && !newMsg.is_read) {
              await supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id);
            }
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) => prev.map((m) => (m.id === newMsg.id ? newMsg : m)));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hydrated, myId, otherId]);

  const sendMessage = async () => {
    if (!input.trim() || !myId || !otherId) return;
    setLoading(true);
    const content = input.trim();
    try {
      const { error } = await supabase.from('messages').insert({
        sender_id: myId,
        receiver_id: otherId,
        content,
        message_type: 'text',
        is_read: false,
      });
      if (error) throw error;

      setInput('');

      const isReceiverAdmin = otherId === 'admin';
      const recipientRole = isReceiverAdmin ? 'admin' : 'fc';
      const residentIdForPush = isReceiverAdmin ? null : otherId;
      const notiBody = content;

      const { error: notifErr } = await supabase.from('notifications').insert({
        title: '새 메시지',
        body: notiBody,
        category: 'message',
        recipient_role: recipientRole,
        resident_id: residentIdForPush,
      });
      if (notifErr) console.warn('[notify] insert failed', notifErr.message);

      try {
        const resp = await fetch('/api/fc-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'message',
            target_role: recipientRole,
            target_id: residentIdForPush,
            message: notiBody,
            sender_id: myId,
          }),
        });
        const data = await resp.json().catch(() => null);
        console.log('[notify] fc-notify proxy response', { status: resp.status, ok: resp.ok, data });
      } catch (err) {
        console.warn('[notify] fc-notify proxy error', err);
      }
    } catch (err: any) {
      notifications.show({ title: '전송 실패', message: err.message ?? '메시지 전송 중 오류', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isReady = hydrated && myId && otherId;

  if (role === 'admin' && !otherId) {
    return (
      <Container size="md" py="xl">
        <Paper shadow="sm" radius="lg" withBorder p="xl">
          <Stack align="center" gap="sm">
            <Title order={4}>대상 선택 필요</Title>
            <Text c="dimmed" size="sm">URL에 targetId(전화번호)와 targetName 쿼리 파라미터를 포함해 접근하세요.</Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="md" p={0} h="100dvh" style={{ overflow: 'hidden' }}>
      <Paper
        radius={0}
        shadow="none"
        withBorder={false}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <Box px="md" py="sm" style={{ borderBottom: '1px solid #f1f3f5', flexShrink: 0 }}>
          <Group gap="xs">
            <ActionIcon variant="subtle" onClick={() => router.back()} aria-label="뒤로가기">
              <IconArrowLeft size={24} color={CHARCOAL} />
            </ActionIcon>
            <Avatar color="orange" radius="xl" size="md">
              {headerTitle?.[0] || <IconUser size={20} />}
            </Avatar>
            <div>
              <Title order={5} c={CHARCOAL} style={{ lineHeight: 1.2 }}>
                {headerTitle || '채팅'}
              </Title>
              <Text size="xs" c="dimmed">
                {role === 'admin' ? 'FC와 1:1 상담' : '총무팀과 1:1 상담'}
              </Text>
            </div>
          </Group>
        </Box>

        {/* Messages */}
        <ScrollArea
          style={{ flex: 1 }}
          viewportRef={viewportRef}
          bg="#f8f9fa"
          px="md"
          py="md"
        >
          {isReady ? (
            messages.length > 0 ? (
              <Stack gap="sm">
                {messages.map((msg) => {
                  const isMe = msg.sender_id === myId;
                  return (
                    <Group key={msg.id} justify={isMe ? 'flex-end' : 'flex-start'} align="flex-end" gap={8}>
                      {!isMe && (
                        <Avatar size="sm" radius="xl" color="gray">
                          <IconUser size={14} />
                        </Avatar>
                      )}
                      <Box
                        style={{
                          maxWidth: '75%',
                          padding: '10px 14px',
                          borderRadius: 16,
                          borderTopRightRadius: isMe ? 2 : 16,
                          borderTopLeftRadius: isMe ? 16 : 2,
                          backgroundColor: isMe ? HANWHA_ORANGE : '#ffffff',
                          color: isMe ? 'white' : CHARCOAL,
                          border: isMe ? 'none' : '1px solid #e5e7eb',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                          wordBreak: 'break-word',
                        }}
                      >
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </Text>
                        {msg.file_url && (
                          <Text
                            size="xs"
                            component="a"
                            href={msg.file_url}
                            target="_blank"
                            rel="noreferrer"
                            mt={4}
                            c={isMe ? 'white' : 'blue'}
                            td="underline"
                            style={{ display: 'block' }}
                          >
                            {msg.file_name || '파일 보기'}
                          </Text>
                        )}
                      </Box>
                      <Text size="xs" c="dimmed" mb={2} style={{ fontSize: 10 }}>
                        {dayjs(msg.created_at).format('HH:mm')}
                      </Text>
                    </Group>
                  );
                })}
              </Stack>
            ) : (
              <Stack align="center" justify="center" h="100%" c="dimmed">
                <Text size="sm">대화 내용이 없습니다.</Text>
              </Stack>
            )
          ) : (
            <Group justify="center" py="xl">
              <Loader color="orange" size="sm" />
            </Group>
          )}
        </ScrollArea>

        {/* Input */}
        <Box
          px="md"
          py="sm"
          bg="white"
          style={{
            borderTop: '1px solid #f1f3f5',
            flexShrink: 0,
            paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
            marginBottom: 12, // 입력창을 화면 맨 아래에서 살짝 띄워서 여유 공간 확보
          }}
        >
          <Group align="flex-end" gap={8}>
            <TextInput
              style={{ flex: 1 }}
              placeholder="메시지 입력"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              radius="xl"
              size="md"
            />
            <ActionIcon
              size={42}
              color="orange"
              variant="filled"
              radius="xl"
              onClick={sendMessage}
              disabled={!input.trim() || loading || !isReady}
              loading={loading}
            >
              <IconSend size={20} />
            </ActionIcon>
          </Group>
        </Box>
      </Paper>
    </Container>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Container py="xl"><Loader /></Container>}>
      <ChatContent />
    </Suspense>
  );
}

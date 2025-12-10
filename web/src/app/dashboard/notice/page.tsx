'use client';

import { useState } from 'react';
import { Button, Container, Paper, Text, TextInput, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { supabase } from '@/lib/supabase';

export default function NoticeCreatePage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('공지사항');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      notifications.show({ title: '알림', message: '제목과 내용을 입력해주세요.', color: 'red' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('notices').insert({ title, body, category });
      if (error) throw error;
      notifications.show({ title: '등록 성공', message: '공지사항이 등록되었습니다.', color: 'green' });
      setTitle('');
      setBody('');
    } catch (err: any) {
      notifications.show({ title: '오류', message: err.message ?? '등록에 실패했습니다.', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" py="xl">
      <Title order={2} mb="xs">
        공지사항 등록
      </Title>
      <Text c="dimmed" mb="xl">
        모든 사용자에게 노출되는 공지를 작성하세요.
      </Text>

      <Paper withBorder shadow="sm" p="xl" radius="md">
        <TextInput
          label="카테고리"
          placeholder="예: 공지사항, 긴급"
          mb="md"
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
        />
        <TextInput
          label="제목"
          placeholder="공지 제목을 입력하세요"
          mb="md"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Textarea
          label="내용"
          placeholder="상세 내용을 입력하세요"
          minRows={6}
          mb="md"
          required
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
        <Button fullWidth color="orange" onClick={handleSubmit} loading={loading}>
          공지 등록
        </Button>
      </Paper>
    </Container>
  );
}

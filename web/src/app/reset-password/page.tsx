'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { Button, Container, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ResetPasswordPage() {
  const { logout } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleRequest = async () => {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      notifications.show({ title: '알림', message: '휴대폰 번호는 숫자 11자리로 입력해주세요.', color: 'red' });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: { phone: digits },
      });
      if (error) {
        let detail = error.message;
        const context = (error as any)?.context as Response | undefined;
        if (context?.text) {
          try {
            detail = await context.text();
          } catch {
            // ignore
          }
        }
        console.warn('reset request failed', detail);
        throw new Error(detail || error.message);
      }
      if (!data?.ok) {
        notifications.show({ title: '알림', message: data?.message ?? '요청에 실패했습니다.', color: 'red' });
        return;
      }
      setRequested(true);
      notifications.show({ title: '안내', message: '인증 코드가 문자로 발송되었습니다.', color: 'green' });
    } catch (err: any) {
      const message = err?.message || '비밀번호 재설정 요청에 실패했습니다.';
      notifications.show({ title: '오류', message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length !== 11) {
      notifications.show({ title: '알림', message: '휴대폰 번호는 숫자 11자리로 입력해주세요.', color: 'red' });
      return;
    }
    if (!token.trim()) {
      notifications.show({ title: '알림', message: '암호를 입력해주세요.', color: 'red' });
      return;
    }
    const trimmedNew = newPassword.trim();
    const hasLetter = /[A-Za-z]/.test(trimmedNew);
    const hasNumber = /[0-9]/.test(trimmedNew);
    const hasSpecial = /[^A-Za-z0-9]/.test(trimmedNew);
    if (trimmedNew.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
      notifications.show({
        title: '알림',
        message: '비밀번호는 8자 이상이며 영문+숫자+특수문자를 포함해야 합니다.',
        color: 'red',
      });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: { phone: digits, token: token.trim(), newPassword: trimmedNew },
      });
      if (error) throw error;
      if (!data?.ok) {
        notifications.show({ title: '알림', message: data?.message ?? '재설정에 실패했습니다.', color: 'red' });
        return;
      }
      await supabase.auth.signOut().catch(() => {});
      logout();
      notifications.show({ title: '완료', message: '비밀번호 변경됨', color: 'green' });
      router.replace('/auth');
    } catch {
      notifications.show({ title: '오류', message: '비밀번호 재설정에 실패했습니다.', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size={420} my={40}>
      <Title ta="center" fw={900}>
        비밀번호 재설정
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        문자로 받은 6자리 코드를 입력해주세요.
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <Stack>
          <TextInput
            label="휴대폰 번호"
            placeholder="숫자 11자리"
            value={phone}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={11}
            onChange={(event) => setPhone(event.currentTarget.value.replace(/[^0-9]/g, ''))}
          />
          <Button variant="light" color="orange" onClick={handleRequest} loading={loading}>
            {requested ? '인증 코드 다시 받기' : '인증 코드 받기'}
          </Button>
          <TextInput
            label="인증 코드"
            placeholder="6자리 숫자 코드"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          <TextInput
            label="새 비밀번호"
            placeholder="8자 이상, 영문+숫자+특수문자"
            value={newPassword}
            type="password"
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />
          <Button color="orange" onClick={handleReset} loading={loading}>
            비밀번호 변경
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

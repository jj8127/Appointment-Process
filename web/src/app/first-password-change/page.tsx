'use client';

import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconCheck, IconKey, IconShieldLock } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function FirstPasswordChangePage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || completed) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/auth/complete-assisted-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, confirm }),
      });
      const data = await response.json() as { ok?: boolean; code?: string; message?: string };
      if (!response.ok || data.ok !== true) {
        if (
          data.code === 'missing_password_change_token'
          || data.code === 'invalid_password_change_token'
          || data.code === 'expired_password_change_token'
        ) {
          router.replace('/auth');
          return;
        }
        throw new Error(data.message || '새 비밀번호를 저장하지 못했습니다.');
      }
      setCompleted(true);
      setNewPassword('');
      setConfirm('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '새 비밀번호를 저장하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box mih="100vh" bg="orange.0" py={{ base: 40, sm: 72 }} px="md">
      <Container size={480}>
        <Stack align="center" gap="lg">
          <ThemeIcon size={52} radius="xl" color="orange" variant="light">
            <IconShieldLock size={26} aria-hidden="true" />
          </ThemeIcon>
          <Box ta="center">
            <Text c="orange.8" fw={800} size="sm">본인 변경 · 마지막 단계</Text>
            <Title order={1} size="h2" mt={4}>새 비밀번호 설정</Title>
            <Text c="dimmed" mt="xs">
              임시 비밀번호와 다른 새 비밀번호를 설정해야 일반 로그인을 시작할 수 있습니다.
            </Text>
          </Box>

          {completed ? (
            <Alert color="green" icon={<IconCheck size={18} />} title="변경을 완료했습니다." w="100%">
              <Stack gap="sm">
                <Text size="sm">새 비밀번호로 다시 로그인해주세요.</Text>
                <Button color="green" onClick={() => router.replace('/auth')}>로그인으로 이동</Button>
              </Stack>
            </Alert>
          ) : (
            <Paper component="form" onSubmit={handleSubmit} withBorder radius="lg" p="xl" w="100%">
              <Stack gap="md">
                <Alert color="orange" variant="light" icon={<IconKey size={18} />}>
                  완료 전에는 관리자 화면이나 FC 기능에 접근할 수 있는 세션이 발급되지 않습니다.
                </Alert>
                {errorMessage ? <Alert color="red" role="alert">{errorMessage}</Alert> : null}
                <PasswordInput
                  required
                  label="새 비밀번호"
                  description="8자 이상, 영문·숫자·특수문자 포함"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  autoComplete="new-password"
                  maxLength={128}
                />
                <PasswordInput
                  required
                  label="새 비밀번호 확인"
                  value={confirm}
                  onChange={(event) => setConfirm(event.currentTarget.value)}
                  autoComplete="new-password"
                  maxLength={128}
                />
                <Button type="submit" color="orange" loading={loading}>
                  새 비밀번호 저장
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Container>
    </Box>
  );
}

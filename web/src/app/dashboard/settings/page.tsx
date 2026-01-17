'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type ConfirmStep = 1 | 2;

export default function SettingsPage() {
  const router = useRouter();
  const { role, residentId, residentMask, displayName, hydrated, logout } = useSession();

  const [opened, setOpened] = useState(false);
  const [step, setStep] = useState<ConfirmStep>(1);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const isFc = role === 'fc';
  const displayRole = role === 'admin' ? '관리자' : 'FC';
  const displaySub = useMemo(() => {
    if (role === 'admin') return '총무 계정';
    return residentMask || '전화번호 미등록';
  }, [role, residentMask]);

  if (!hydrated) return null;

  const openModal = () => {
    setStep(1);
    setConfirmChecked(false);
    setOpened(true);
  };

  const closeModal = () => {
    if (loading) return;
    setOpened(false);
  };

  const handleDeleteAccount = async () => {
    if (!isFc) {
      notifications.show({
        title: '계정 삭제 불가',
        message: '관리자 계정은 삭제할 수 없습니다.',
        color: 'red',
      });
      return;
    }

    if (!residentId) {
      notifications.show({
        title: '계정 정보 없음',
        message: '현재 로그인 정보를 확인할 수 없습니다.',
        color: 'red',
      });
      return;
    }

    setLoading(true);

    try {
      const { data: profile, error: profileError } = await supabase
        .from('fc_profiles')
        .select('id, name')
        .eq('phone', residentId)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile?.id) throw new Error('프로필 정보를 찾을 수 없습니다.');

      const { data: docs, error: docsError } = await supabase
        .from('fc_documents')
        .select('storage_path')
        .eq('fc_id', profile.id);

      if (docsError) throw docsError;

      const storagePaths = (docs ?? []).map((doc) => doc.storage_path).filter(Boolean);
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from('fc-documents').remove(storagePaths);
        if (storageError) throw storageError;
      }

      const { error: docDeleteError } = await supabase.from('fc_documents').delete().eq('fc_id', profile.id);
      if (docDeleteError) throw docDeleteError;

      const { error: examDeleteError } = await supabase
        .from('exam_registrations')
        .delete()
        .eq('resident_id', residentId);
      if (examDeleteError) throw examDeleteError;

      const { error: messageDeleteError } = await supabase
        .from('messages')
        .delete()
        .or(`sender_id.eq.${residentId},receiver_id.eq.${residentId}`);
      if (messageDeleteError) throw messageDeleteError;

      const { error: notificationDeleteError } = await supabase
        .from('notifications')
        .delete()
        .eq('recipient_role', 'fc')
        .eq('resident_id', residentId);
      if (notificationDeleteError) throw notificationDeleteError;

      const { error: tokenDeleteError } = await supabase
        .from('device_tokens')
        .delete()
        .eq('resident_id', residentId);
      if (tokenDeleteError) throw tokenDeleteError;

      const { error: profileDeleteError } = await supabase
        .from('fc_profiles')
        .delete()
        .eq('id', profile.id);
      if (profileDeleteError) throw profileDeleteError;

      notifications.show({
        title: '계정 삭제 완료',
        message: '계정과 관련 데이터가 삭제되었습니다.',
        color: 'green',
      });
      setOpened(false);
      logout();
      router.replace('/auth');
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({
        title: '계정 삭제 실패',
        message: error?.message ?? '계정 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" py="lg">
      <Stack gap="lg">
        <Paper withBorder radius="md" p="lg">
          <Stack gap="sm">
            <Title order={3}>설정</Title>
            <Text size="sm" c="dimmed">
              계정 정보를 확인하고 필요한 설정을 관리하세요.
            </Text>
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <Title order={4}>계정</Title>
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  이름
                </Text>
                <Text size="sm" fw={600}>
                  {displayName?.trim() || displayRole}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  역할
                </Text>
                <Text size="sm" fw={600}>
                  {displayRole}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  연락처
                </Text>
                <Text size="sm" fw={600}>
                  {displaySub}
                </Text>
              </Group>
            </Stack>

            <Divider my="sm" />

            <Stack gap="xs">
              <Text size="sm" fw={600} c="red">
                계정 삭제
              </Text>
              <Text size="xs" c="dimmed">
                계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.
              </Text>
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  onClick={openModal}
                  disabled={!isFc}
                  styles={{
                    root: {
                      padding: 0,
                      height: 'auto',
                      fontWeight: 600,
                      '&:hover': {
                        backgroundColor: 'rgba(250, 82, 82, 0.08)',
                        textDecoration: 'underline',
                      },
                    },
                  }}
                >
                  계정 삭제
                </Button>
              </Group>
              {!isFc && (
                <Text size="xs" c="dimmed">
                  관리자 계정은 삭제할 수 없습니다.
                </Text>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Stack>

      <Modal opened={opened} onClose={closeModal} centered title={step === 1 ? '정말 삭제할까요?' : '삭제 확인'}>
        {step === 1 ? (
          <Stack gap="md">
            <Group gap="sm">
              <IconAlertTriangle size={20} color="#fa5252" />
              <Text size="sm">
                계정을 삭제하면 복구할 수 없습니다. 계속 진행하시겠습니까?
              </Text>
            </Group>
            <Group justify="flex-end">
              <Button variant="default" onClick={closeModal} disabled={loading}>
                취소
              </Button>
              <Button color="red" onClick={() => setStep(2)} disabled={loading}>
                계속
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="md">
            <Text size="sm">
              계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.
            </Text>
            <Checkbox
              label="모든 데이터가 삭제됨을 이해했습니다."
              checked={confirmChecked}
              onChange={(event) => setConfirmChecked(event.currentTarget.checked)}
            />
            <Group justify="space-between">
              <Button variant="default" onClick={() => setStep(1)} disabled={loading}>
                이전
              </Button>
              <Button
                color="red"
                onClick={handleDeleteAccount}
                loading={loading}
                disabled={!confirmChecked}
              >
                계정 삭제 확정
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}

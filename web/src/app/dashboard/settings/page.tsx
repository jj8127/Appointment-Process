'use client';

import { useSession } from '@/hooks/use-session';
import { getDashboardRoleLabel, getDashboardRoleSubLabel } from '@/lib/staff-identity';
import {
  getWebPushPermissionState,
  registerWebPushSubscription,
  type WebPushPermissionState,
} from '@/components/WebPushRegistrar';
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
import { IconAlertTriangle, IconBell } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type ConfirmStep = 1 | 2;

export default function SettingsPage() {
  const router = useRouter();
  const { role, residentId, residentMask, displayName, hydrated, logout, staffType, isReadOnly } = useSession();

  const [opened, setOpened] = useState(false);
  const [step, setStep] = useState<ConfirmStep>(1);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushPermission, setPushPermission] = useState<WebPushPermissionState>('unsupported');

  const deleteRole = role === 'admin' ? 'admin' : role === 'manager' ? 'manager' : role === 'fc' ? 'fc' : null;
  const displayRole = getDashboardRoleLabel({ role, staffType, isReadOnly });
  const displaySub = useMemo(() => {
    const roleSub = getDashboardRoleSubLabel({ role, staffType, isReadOnly });
    if (roleSub) return roleSub;
    return residentMask || '전화번호 미등록';
  }, [isReadOnly, residentMask, role, staffType]);

  useEffect(() => {
    if (!hydrated) return;
    setPushPermission(getWebPushPermissionState());
  }, [hydrated]);

  const pushStatusText = useMemo(() => {
    if (pushPermission === 'granted') return '알림 허용됨';
    if (pushPermission === 'denied') return '알림 차단됨';
    if (pushPermission === 'default') return '아직 설정되지 않음';
    return '이 브라우저는 웹 푸시를 지원하지 않습니다.';
  }, [pushPermission]);

  const pushButtonLabel = useMemo(() => {
    if (pushPermission === 'granted') return '웹 알림 재등록';
    if (pushPermission === 'denied') return '권한 재확인';
    if (pushPermission === 'default') return '웹 알림 허용';
    return '지원되지 않음';
  }, [pushPermission]);

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
    if (!residentId) {
      notifications.show({
        title: '계정 정보 없음',
        message: '현재 로그인 정보를 확인할 수 없습니다.',
        color: 'red',
      });
      return;
    }
    if (!deleteRole) {
      notifications.show({
        title: '계정 정보 없음',
        message: '현재 로그인 정보를 확인할 수 없습니다.',
        color: 'red',
      });
      return;
    }

    setLoading(true);

    try {
      console.log('[Settings] Starting account deletion via delete-account function', {
        residentId,
        residentMask,
      });

      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; deleted?: boolean; error?: string }>(
        'delete-account',
        {
          body: { residentId, residentMask, role: deleteRole },
        },
      );
      if (error) {
        throw new Error(error.message ?? '계정 삭제 함수 호출에 실패했습니다.');
      }
      if (!data?.ok || !data?.deleted) {
        throw new Error(data?.error ?? '계정 삭제에 실패했습니다. 다시 시도해주세요.');
      }

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
      console.error('[Settings] Account deletion failed', error);
      notifications.show({
        title: '계정 삭제 실패',
        message: error?.message ?? '계정 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEnableWebPush = async () => {
    setPushLoading(true);

    try {
      const result = await registerWebPushSubscription(role, residentId, { forceResubscribe: true });
      setPushPermission(result.permission);

      if (result.ok) {
        notifications.show({
          title: '웹 알림 설정 완료',
          message: '브라우저 웹 알림이 정상 등록되었습니다.',
          color: 'green',
        });
        return;
      }

      if (result.message === 'unsupported') {
        notifications.show({
          title: '지원되지 않음',
          message: '현재 브라우저에서는 웹 알림을 지원하지 않습니다.',
          color: 'orange',
        });
        return;
      }

      if (result.message === 'permission-not-granted') {
        notifications.show({
          title: '알림 권한 필요',
          message: '브라우저 사이트 설정에서 알림을 허용한 뒤 다시 시도해주세요.',
          color: 'orange',
        });
        return;
      }

      notifications.show({
        title: '웹 알림 등록 실패',
        message: result.message ?? '알 수 없는 오류가 발생했습니다.',
        color: 'red',
      });
    } catch (err: unknown) {
      const error = err as Error;
      notifications.show({
        title: '웹 알림 등록 실패',
        message: error?.message ?? '오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPushLoading(false);
      setPushPermission(getWebPushPermissionState());
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
              <Group gap={6}>
                <IconBell size={16} />
                <Text size="sm" fw={600}>
                  웹 알림
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                상태: {pushStatusText}
              </Text>
              <Group justify="flex-end">
                <Button
                  size="xs"
                  variant="light"
                  onClick={handleEnableWebPush}
                  loading={pushLoading}
                  disabled={pushPermission === 'unsupported'}
                >
                  {pushButtonLabel}
                </Button>
              </Group>
              {pushPermission === 'denied' && (
                <Text size="xs" c="dimmed">
                  브라우저 주소창 사이트 설정에서 알림 권한을 허용해야 수신됩니다.
                </Text>
              )}
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
                  disabled={!deleteRole}
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

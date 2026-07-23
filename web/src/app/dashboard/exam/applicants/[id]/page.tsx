'use client';

import { useSession } from '@/hooks/use-session';
import {
  EXAM_APPLICANT_TABLE_BADGE_STYLES,
  formatExamApplicantReceptionStatus,
  getExamApplicantCellValue,
} from '@/lib/exam-applicant-list-display';
import { notifyFcExamApprovalStatus } from '@/lib/exam-applicant-notification-client';
import { buildExamPaymentProofImagePath } from '@/lib/exam-payment-proof-admin';
import {
  Alert,
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Grid,
  Group,
  Image,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardCheck,
  IconCreditCard,
  IconExternalLink,
  IconMapPin,
  IconPhoto,
  IconPhone,
  IconUser,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import styles from './page.module.css';

const HANWHA_ORANGE = '#F37321';
const CHARCOAL = '#111827';
const MUTED = '#6B7280';

type Applicant = {
  id: string;
  status: string;
  created_at: string;
  round_id: string | null;
  resident_id: string;
  name: string;
  phone: string;
  affiliation: string;
  address: string;
  location_name: string;
  round_label: string;
  exam_date: string | null;
  exam_type?: string | null;
  fee_paid_date?: string | null;
  payment_proof_attached?: boolean;
  is_confirmed: boolean;
  is_third_exam?: boolean;
  application_type?: string | null;
};

type ApplicantNavigation = {
  previousId: string | null;
  nextId: string | null;
};

type ApplicantDetailData = {
  applicant: Applicant;
  navigation: ApplicantNavigation;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <Paper withBorder radius="md" p="md" bg="gray.0">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" color="orange" radius="xl" size="lg">
          {icon}
        </ThemeIcon>
        <Stack gap={3} style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} c="dimmed">{label}</Text>
          <Text size="sm" fw={600} c={CHARCOAL} style={{ wordBreak: 'break-word' }}>
            {value || '-'}
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

function PaymentProofCard({
  registrationId,
  attached,
}: {
  registrationId: string;
  attached: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imagePath = buildExamPaymentProofImagePath(registrationId);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={4} c={CHARCOAL}>입금 증빙 확인</Title>
          <Text size="sm" c="dimmed">FC가 시험 신청 시 첨부한 입금 내역 사진입니다.</Text>
        </div>
        <ThemeIcon color="orange" variant="light" radius="xl" size="xl">
          <IconPhoto size={22} />
        </ThemeIcon>
      </Group>

      {!attached ? (
        <Paper withBorder radius="md" p="xl" bg="gray.0">
          <Stack align="center" gap="xs">
            <IconPhoto size={34} color="#adb5bd" />
            <Text size="sm" c="dimmed">첨부된 입금 증빙이 없습니다.</Text>
          </Stack>
        </Paper>
      ) : imageFailed ? (
        <Alert color="red" title="입금 증빙을 열 수 없습니다." icon={<IconAlertCircle size={18} />}>
          잠시 후 다시 시도해주세요.
        </Alert>
      ) : (
        <Stack gap="md">
          <Paper withBorder radius="md" p="sm" bg="gray.0">
            <Image
              src={imagePath}
              alt="입금 증빙 이미지"
              radius="sm"
              fit="contain"
              mah={480}
              onError={() => setImageFailed(true)}
            />
          </Paper>
          <Button
            component="a"
            href={imagePath}
            target="_blank"
            rel="noopener noreferrer"
            variant="light"
            color="orange"
            leftSection={<IconExternalLink size={17} />}
            style={{ alignSelf: 'flex-start' }}
          >
            원본 이미지 열기
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

export default function ExamApplicantDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const registrationId = Array.isArray(params.id) ? params.id[0] : params.id;
  const queryClient = useQueryClient();
  const { hydrated, isReadOnly } = useSession();

  const detailQueryKey = ['exam-applicant-detail', registrationId];
  const { data: detailData, isLoading, error } = useQuery({
    queryKey: detailQueryKey,
    enabled: hydrated && Boolean(registrationId),
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/exam-applicants?registrationId=${encodeURIComponent(registrationId)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(json) || json.ok !== true || !Array.isArray(json.applicants)) {
        const message = isRecord(json) && typeof json.error === 'string'
          ? json.error
          : '시험 신청 정보를 불러오지 못했습니다.';
        throw new Error(message);
      }

      const first = json.applicants[0];
      if (!first) {
        throw new Error('해당 시험 신청 정보를 찾을 수 없습니다.');
      }
      const navigation = isRecord(json.navigation)
        ? {
            previousId: typeof json.navigation.previousId === 'string' ? json.navigation.previousId : null,
            nextId: typeof json.navigation.nextId === 'string' ? json.navigation.nextId : null,
          }
        : { previousId: null, nextId: null };
      return { applicant: first as Applicant, navigation } satisfies ApplicantDetailData;
    },
  });
  const applicant = detailData?.applicant;
  const navigation = detailData?.navigation ?? { previousId: null, nextId: null };

  const receptionMutation = useMutation({
    mutationFn: async () => {
      if (!applicant) throw new Error('시험 신청 정보를 찾을 수 없습니다.');
      const response = await fetch('/api/admin/exam-applicants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ registrationId: applicant.id, isConfirmed: true }),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(json) || json.ok !== true) {
        const message = isRecord(json) && typeof json.error === 'string'
          ? json.error
          : '시험 접수 처리에 실패했습니다.';
        throw new Error(message);
      }
      return applicant;
    },
    onSuccess: async (item) => {
      queryClient.setQueryData<ApplicantDetailData>(detailQueryKey, (current) => ({
        applicant: { ...item, is_confirmed: true, status: 'confirmed' },
        navigation: current?.navigation ?? { previousId: null, nextId: null },
      }));
      queryClient.invalidateQueries({ queryKey: ['exam-applicants-all-recent'] });
      notifications.show({
        title: '시험 접수 완료',
        message: '시험 신청이 접수 완료 상태로 변경되었습니다.',
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      await notifyFcExamApprovalStatus(item, true);
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error
        ? mutationError.message
        : '시험 접수 처리 중 오류가 발생했습니다.';
      notifications.show({ title: '시험 접수 실패', message, color: 'red' });
    },
  });

  if (!hydrated || isLoading) {
    return (
      <Container size="lg" py={80}>
        <Stack align="center" gap="sm">
          <Loader color="orange" type="dots" />
          <Text size="sm" c="dimmed">신청자 정보를 불러오는 중입니다.</Text>
        </Stack>
      </Container>
    );
  }

  if (error || !applicant) {
    return (
      <Container size="md" py="xl">
        <Stack gap="lg">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.push('/dashboard/exam/applicants')}
            style={{ alignSelf: 'flex-start' }}
          >
            신청자 목록
          </Button>
          <Alert color="red" title="신청 정보를 열 수 없습니다." icon={<IconAlertCircle size={18} />}>
            {error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.'}
          </Alert>
        </Stack>
      </Container>
    );
  }

  const receptionLabel = formatExamApplicantReceptionStatus(applicant);
  const subjectLabel = getExamApplicantCellValue(applicant, 'subject_display');
  const thirdExamLabel = getExamApplicantCellValue(applicant, 'third_exam');
  const examDateLabel = applicant.exam_date
    ? `${dayjs(applicant.exam_date).format('YYYY-MM-DD')} · ${applicant.round_label || '회차 미정'}`
    : applicant.round_label || '시험일 미정';

  return (
    <Box bg="gray.0" mih="100vh">
      <Tooltip label="이전 신청자" position="right" disabled={!navigation.previousId}>
        <ActionIcon
          className={`${styles.sideNavigationButton} ${styles.sideNavigationPrevious}`}
          variant="default"
          radius="xl"
          size={56}
          aria-label="이전 신청자로 이동"
          disabled={!navigation.previousId}
          onClick={() => {
            if (navigation.previousId) {
              router.push(`/dashboard/exam/applicants/${encodeURIComponent(navigation.previousId)}`);
            }
          }}
        >
          <IconChevronLeft size={30} stroke={2.2} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="다음 신청자" position="left" disabled={!navigation.nextId}>
        <ActionIcon
          className={`${styles.sideNavigationButton} ${styles.sideNavigationNext}`}
          variant="default"
          radius="xl"
          size={56}
          aria-label="다음 신청자로 이동"
          disabled={!navigation.nextId}
          onClick={() => {
            if (navigation.nextId) {
              router.push(`/dashboard/exam/applicants/${encodeURIComponent(navigation.nextId)}`);
            }
          }}
        >
          <IconChevronRight size={30} stroke={2.2} />
        </ActionIcon>
      </Tooltip>
      <Container size="xl" py="xl">
        <Stack gap="lg">
          <Group justify="space-between" align="center">
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => router.push('/dashboard/exam/applicants')}
            >
              신청자 목록으로
            </Button>
            <Group gap="xs" wrap="wrap" justify="flex-end">
              <Badge
                size="lg"
                radius="xl"
                color={applicant.is_confirmed ? 'orange' : 'gray'}
                variant={applicant.is_confirmed ? 'filled' : 'light'}
              >
                {receptionLabel}
              </Badge>
            </Group>
          </Group>

          <Paper withBorder radius="lg" p={{ base: 'lg', md: 'xl' }} shadow="sm" bg="white" style={{ borderLeft: `5px solid ${HANWHA_ORANGE}` }}>
            <Group align="center" gap="lg" wrap="wrap">
              <Avatar size={72} radius="xl" color="orange" variant="light">
                {(applicant.name || '?').slice(0, 1)}
              </Avatar>
              <Stack gap={5} style={{ flex: 1, minWidth: 220 }}>
                <Text size="xs" c="orange" fw={800}>시험 신청자 상세</Text>
                <Title order={2} c={CHARCOAL}>{applicant.name || '이름 미정'}</Title>
                <Group gap="md" wrap="wrap">
                  <Group gap={6}>
                    <IconBuilding size={16} color={MUTED} />
                    <Text size="sm" c={MUTED}>{applicant.affiliation || '소속 미정'}</Text>
                  </Group>
                  <Group gap={6}>
                    <IconPhone size={16} color={MUTED} />
                    <Text size="sm" c={MUTED}>{applicant.phone || '-'}</Text>
                  </Group>
                </Group>
              </Stack>
              <Stack gap={3} align="flex-end">
                <Text size="xs" c="dimmed" fw={700}>신청일</Text>
                <Text fw={700}>{dayjs(applicant.created_at).format('YYYY-MM-DD')}</Text>
                <Badge variant="light" color="blue" radius="sm" styles={EXAM_APPLICANT_TABLE_BADGE_STYLES}>
                  {subjectLabel}
                </Badge>
              </Stack>
            </Group>
          </Paper>

          <Grid gutter="lg" align="stretch">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Stack gap="lg">
                <Card withBorder radius="lg" padding="xl" shadow="xs">
                  <Group justify="space-between" mb="lg">
                    <div>
                      <Title order={4} c={CHARCOAL}>신청자 정보</Title>
                      <Text size="sm" c="dimmed">접수에 필요한 기본 정보를 확인합니다.</Text>
                    </div>
                    <ThemeIcon color="orange" variant="light" radius="xl" size="xl">
                      <IconUser size={22} />
                    </ThemeIcon>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <DetailItem label="소속 본부" value={applicant.affiliation || '소속 미정'} icon={<IconBuilding size={18} />} />
                    <DetailItem label="연락처" value={applicant.phone || '-'} icon={<IconPhone size={18} />} />
                    <DetailItem label="주민등록번호" value={applicant.resident_id || '-'} icon={<IconClipboardCheck size={18} />} />
                    <DetailItem label="주소" value={applicant.address || '-'} icon={<IconMapPin size={18} />} />
                  </SimpleGrid>
                </Card>

                <Card withBorder radius="lg" padding="xl" shadow="xs">
                  <Group justify="space-between" mb="lg">
                    <div>
                      <Title order={4} c={CHARCOAL}>시험 신청 정보</Title>
                      <Text size="sm" c="dimmed">선택한 회차와 접수 조건을 한눈에 확인합니다.</Text>
                    </div>
                    <ThemeIcon color="orange" variant="light" radius="xl" size="xl">
                      <IconCalendarEvent size={22} />
                    </ThemeIcon>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <DetailItem label="응시 과목" value={subjectLabel} icon={<IconClipboardCheck size={18} />} />
                    <DetailItem label="신청 구분" value={applicant.application_type || '-'} icon={<IconUser size={18} />} />
                    <DetailItem label="시험 일정" value={examDateLabel} icon={<IconCalendarEvent size={18} />} />
                    <DetailItem label="고사장" value={applicant.location_name || '미정'} icon={<IconMapPin size={18} />} />
                    <DetailItem label="제3보험" value={thirdExamLabel} icon={<IconClipboardCheck size={18} />} />
                    <DetailItem label="응시료 입금일" value={applicant.fee_paid_date || '-'} icon={<IconCreditCard size={18} />} />
                  </SimpleGrid>
                </Card>

              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Card withBorder radius="lg" padding="xl" shadow="sm" h="100%">
                <Stack gap="lg" h="100%">
                  <div>
                    <Text size="xs" c="orange" fw={800}>접수 상태</Text>
                    <Title order={3} mt={4} c={CHARCOAL}>{receptionLabel}</Title>
                    <Text size="sm" c="dimmed" mt="xs">
                      {applicant.is_confirmed
                        ? '관리자가 시험 접수를 완료한 신청입니다.'
                        : '신청 내용을 확인한 뒤 시험 접수를 완료해주세요.'}
                    </Text>
                  </div>

                  <Divider />

                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">응시 과목</Text>
                      <Text size="sm" fw={700}>{subjectLabel}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">고사장</Text>
                      <Text size="sm" fw={700}>{applicant.location_name || '미정'}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">입금 확인</Text>
                      <Text size="sm" fw={700}>{applicant.fee_paid_date ? '확인' : '미입력'}</Text>
                    </Group>
                  </Stack>

                  <Divider />

                  <PaymentProofCard
                    key={applicant.id}
                    registrationId={applicant.id}
                    attached={Boolean(applicant.payment_proof_attached)}
                  />

                  <Box mt="auto">
                    <Button
                      fullWidth
                      size="lg"
                      radius="md"
                      color="orange"
                      leftSection={<IconCheck size={19} />}
                      loading={receptionMutation.isPending}
                      disabled={isReadOnly || applicant.is_confirmed}
                      onClick={() => receptionMutation.mutate()}
                    >
                      {applicant.is_confirmed ? '접수 완료' : '시험 접수하기'}
                    </Button>
                    {isReadOnly ? (
                      <Text size="xs" c="dimmed" ta="center" mt="sm">
                        본부장 계정은 신청 내용을 확인만 할 수 있습니다.
                      </Text>
                    ) : null}
                  </Box>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Stack>
      </Container>
    </Box>
  );
}

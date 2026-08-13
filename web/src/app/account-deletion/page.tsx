'use client';

import {
  Anchor,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconLock,
  IconShieldCheck,
  IconTrash,
  IconUserX,
} from '@tabler/icons-react';

const ADMIN_WEB_URL = 'https://adminweb-red.vercel.app';

const deletionSteps = [
  '가람 in 앱 또는 관리자 웹에 로그인합니다.',
  '설정 화면으로 이동합니다.',
  '계정 삭제를 선택하고 확인 절차를 완료합니다.',
];

const deletedData = [
  '계정 프로필과 로그인에 필요한 인증 정보',
  '앱 알림, 기기 토큰, 접속 상태 등 계정에 연결된 운영 데이터',
  '제출 문서와 첨부파일 등 사용자가 업로드한 파일',
  '게시글, 메시지, 채팅 첨부파일 등 계정 식별자에 연결된 데이터',
];

const retainedData = [
  '법령, 분쟁 대응, 부정 이용 방지, 정산 또는 감사 목적에 필요한 최소 기록',
  '추천 및 운영 이력처럼 삭제 후에도 식별자를 제거하거나 오류 정정 형태로 보존해야 하는 업무 기록',
  '백업, 로그, 비식별 통계처럼 즉시 삭제가 어려운 시스템 보관 데이터',
];

export default function AccountDeletionPage() {
  return (
    <Box bg="#f8fafc" mih="100vh" py={{ base: 28, sm: 44 }}>
      <Container size="md">
        <Stack gap="lg">
          <Paper withBorder radius="md" p={{ base: 'lg', sm: 'xl' }} shadow="xs">
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start" gap="md">
                <Stack gap={6}>
                  <Badge color="orange" variant="light" radius="sm">
                    Google Play 데이터 삭제 안내
                  </Badge>
                  <Title order={1} size="h2">
                    가람 in 계정 및 데이터 삭제
                  </Title>
                  <Text c="dimmed" maw={680}>
                    이 페이지는 가람 in 사용자가 계정과 관련 데이터를 삭제하는 방법을 안내합니다. 계정 삭제는
                    로그인한 사용자 본인 또는 관리자 웹의 설정 화면에서 직접 요청할 수 있습니다.
                  </Text>
                </Stack>
                <ThemeIcon size={54} radius="md" color="orange" variant="light">
                  <IconUserX size={30} />
                </ThemeIcon>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Paper withBorder radius="md" p="md" bg="#fffdf8">
                  <Stack gap="xs">
                    <Group gap="xs">
                      <ThemeIcon color="orange" variant="light" radius="sm">
                        <IconTrash size={18} />
                      </ThemeIcon>
                      <Text fw={800}>앱에서 삭제하기</Text>
                    </Group>
                    <List spacing={8} size="sm" c="#334155" icon={<IconCheck size={16} />}>
                      {deletionSteps.map((step) => (
                        <List.Item key={step}>{step}</List.Item>
                      ))}
                    </List>
                  </Stack>
                </Paper>

                <Paper withBorder radius="md" p="md" bg="#f8fbff">
                  <Stack gap="xs">
                    <Group gap="xs">
                      <ThemeIcon color="blue" variant="light" radius="sm">
                        <IconLock size={18} />
                      </ThemeIcon>
                      <Text fw={800}>로그인이 어려운 경우</Text>
                    </Group>
                    <Text size="sm" c="#334155">
                      비밀번호를 잊었거나 계정 접근이 어렵다면 먼저 로그인 화면에서 비밀번호 재설정을 진행하세요.
                      그래도 접근할 수 없다면 소속 관리자 또는 가람 in 운영 담당자에게 계정 삭제 요청을 전달해야
                      합니다.
                    </Text>
                  </Stack>
                </Paper>
              </SimpleGrid>

              <Group gap="sm">
                <Button component="a" href={`${ADMIN_WEB_URL}/auth`} color="orange" rightSection={<IconExternalLink size={16} />}>
                  관리자 웹 로그인
                </Button>
                <Button
                  component="a"
                  href="https://play.google.com/store/apps/details?id=com.jj8127.Garam_in"
                  variant="default"
                  rightSection={<IconExternalLink size={16} />}
                >
                  Google Play에서 열기
                </Button>
              </Group>
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p={{ base: 'lg', sm: 'xl' }}>
            <Stack gap="md">
              <Group gap="xs">
                <ThemeIcon color="green" variant="light" radius="sm">
                  <IconShieldCheck size={18} />
                </ThemeIcon>
                <Title order={2} size="h3">
                  삭제되는 데이터
                </Title>
              </Group>
              <List spacing={8} size="sm" c="#334155" icon={<IconCheck size={16} />}>
                {deletedData.map((item) => (
                  <List.Item key={item}>{item}</List.Item>
                ))}
              </List>

              <Divider />

              <Group gap="xs">
                <ThemeIcon color="yellow" variant="light" radius="sm">
                  <IconAlertCircle size={18} />
                </ThemeIcon>
                <Title order={2} size="h3">
                  일부 보관될 수 있는 데이터
                </Title>
              </Group>
              <Text size="sm" c="dimmed">
                계정 삭제 후에도 아래 항목은 법적 의무, 보안, 정산, 감사 목적에 필요한 기간 동안 제한적으로
                보관될 수 있습니다. 보관 기간이 끝나면 삭제 또는 비식별 처리합니다.
              </Text>
              <List spacing={8} size="sm" c="#334155">
                {retainedData.map((item) => (
                  <List.Item key={item}>{item}</List.Item>
                ))}
              </List>
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p={{ base: 'lg', sm: 'xl' }}>
            <Stack gap="sm">
              <Title order={2} size="h3">
                처리 기준
              </Title>
              <Text size="sm" c="#334155">
                계정 삭제 요청이 정상적으로 완료되면 서비스 이용에 필요한 계정 접근 권한은 종료됩니다. 운영상
                즉시 삭제 가능한 데이터는 삭제하고, 보관 의무가 있는 데이터는 필요한 기간이 지난 뒤 삭제 또는
                비식별 처리합니다.
              </Text>
              <Text size="sm" c="dimmed">
                개인정보 처리 기준은{' '}
                <Anchor
                  href="https://doc-hosting.flycricket.io/garam-in-privacy-policy/bdfebf59-739e-406a-9a21-9bb7d38ddb40/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  가람 in 개인정보처리방침
                </Anchor>
                을 함께 참고하세요.
              </Text>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

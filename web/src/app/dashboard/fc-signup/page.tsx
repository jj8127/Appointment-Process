'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconFileCheck,
  IconKey,
  IconSearch,
  IconShieldCheck,
  IconUserPlus,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useSession } from '@/hooks/use-session';
import {
  ADMIN_ASSISTED_AFFILIATION_OPTIONS,
  ADMIN_ASSISTED_CARRIER_OPTIONS,
  ADMIN_ASSISTED_LICENSE_OPTIONS,
  getSeoulTodayIsoDate,
  type SignupReferralSearchResult,
} from '@/lib/admin-assisted-signup-contract';

type FormState = {
  name: string;
  phone: string;
  affiliation: string;
  email: string;
  carrier: string;
  licenseStatuses: string[];
  consentObtainedOn: string;
  evidenceReference: string;
  password: string;
  confirmPassword: string;
  consentAttested: boolean;
};

const initialForm = (): FormState => ({
  name: '',
  phone: '',
  affiliation: '',
  email: '',
  carrier: '',
  licenseStatuses: ['none'],
  consentObtainedOn: getSeoulTodayIsoDate(),
  evidenceReference: '',
  password: '',
  confirmPassword: '',
  consentAttested: false,
});

function createRequestId() {
  return crypto.randomUUID();
}

function VerificationLedger() {
  const steps = [
    { icon: IconFileCheck, label: '관리자 확인', detail: '서면 동의 근거 기록', active: true },
    { icon: IconKey, label: '임시 비밀번호', detail: '일반 세션 발급 전', active: true },
    { icon: IconShieldCheck, label: '본인 변경', detail: '첫 로그인에서 필수', active: false },
  ];

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" aria-label="가입 보안 단계">
      {steps.map(({ icon: Icon, label, detail, active }, index) => (
        <Paper
          key={label}
          withBorder
          radius="md"
          p="sm"
          bg={active ? 'orange.0' : 'gray.0'}
          style={{ borderColor: active ? 'var(--mantine-color-orange-3)' : undefined }}
        >
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant={active ? 'light' : 'default'} color="orange" radius="xl">
              <Icon size={17} aria-hidden="true" />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed">{index + 1}단계</Text>
              <Text size="sm" fw={700}>{label}</Text>
              <Text size="xs" c="dimmed">{detail}</Text>
            </Box>
          </Group>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

export default function AdminAssistedSignupPage() {
  const { hydrated, role, staffType, isReadOnly } = useSession();
  const [form, setForm] = useState<FormState>(() => initialForm());
  const [requestId, setRequestId] = useState(() => createRequestId());
  const [referralQuery, setReferralQuery] = useState('');
  const [referralResults, setReferralResults] = useState<SignupReferralSearchResult[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<SignupReferralSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ alreadyApplied: boolean } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const canCreate = hydrated
    && role === 'admin'
    && !isReadOnly
    && (staffType === 'admin' || staffType === 'developer');

  useEffect(() => {
    if (!canCreate || selectedReferral || referralQuery.trim().length < 2) {
      setReferralResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(
          `/api/admin/assisted-signup?q=${encodeURIComponent(referralQuery.trim())}`,
          { signal: controller.signal },
        );
        const data = await response.json() as {
          ok?: boolean;
          results?: SignupReferralSearchResult[];
          message?: string;
        };
        if (!response.ok || data.ok !== true) {
          throw new Error(data.message || '추천인 검색에 실패했습니다.');
        }
        setReferralResults((data.results ?? []).filter((result) => (
          typeof result.fcId === 'string'
          && typeof result.name === 'string'
          && typeof result.code === 'string'
        )));
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : '추천인 검색에 실패했습니다.');
        setReferralResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canCreate, referralQuery, selectedReferral]);

  const selectedLicenseLabels = (
    form.licenseStatuses.map((value) => (
      ADMIN_ASSISTED_LICENSE_OPTIONS.find((option) => option.value === value)?.label ?? value
    )).join(', ')
  );

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSubmitError(null);
    setCreated(null);
  };

  const toggleLicense = (value: string) => {
    setForm((current) => {
      if (value === 'none') return { ...current, licenseStatuses: ['none'] };
      const selected = current.licenseStatuses.filter((status) => status !== 'none');
      const next = selected.includes(value)
        ? selected.filter((status) => status !== value)
        : [...selected, value];
      return { ...current, licenseStatuses: next.length > 0 ? next : ['none'] };
    });
    setSubmitError(null);
  };

  const resetForm = () => {
    setForm(initialForm());
    setReferralQuery('');
    setReferralResults([]);
    setSelectedReferral(null);
    setRequestId(createRequestId());
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate || submitting) return;
    if (!selectedReferral) {
      setSubmitError('추천인을 검색해 한 명 선택해주세요.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setCreated(null);
    try {
      const response = await fetch('/api/admin/assisted-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          ...form,
          phone: form.phone.replace(/[^0-9]/g, ''),
          inviterFcId: selectedReferral.fcId,
        }),
      });
      const data = await response.json() as {
        ok?: boolean;
        message?: string;
        alreadyApplied?: boolean;
      };
      if (!response.ok || data.ok !== true) {
        throw new Error(data.message || '회원가입을 생성하지 못했습니다.');
      }

      setCreated({ alreadyApplied: data.alreadyApplied === true });
      resetForm();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '회원가입을 생성하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated) return null;

  if (!canCreate) {
    return (
      <Container size="sm" py="xl">
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="접근 권한이 없습니다.">
          관리자 또는 개발자 계정만 서면확인 회원가입을 생성할 수 있습니다. 본부장은 읽기 전용입니다.
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="lg" py={{ base: 'md', md: 'xl' }}>
      <Stack gap="lg">
        <Box>
          <Text c="orange.7" fw={800} size="sm" tt="uppercase" mb={4}>
            Controlled onboarding
          </Text>
          <Title order={1} size="h2">관리자 서면확인 회원가입</Title>
          <Text c="dimmed" mt="xs" maw={760}>
            문자 수신이 어려운 FC의 서면 동의를 확인해 계정을 생성합니다. 이 절차는 휴대폰 인증 완료로 기록되지 않습니다.
          </Text>
        </Box>

        <VerificationLedger />

        <Alert
          color="orange"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title="휴대폰 인증을 대체 표시하지 않습니다."
        >
          계정에는 관리자 서면확인 근거와 실행자가 남습니다. 임시 비밀번호로는 일반 세션이 발급되지 않으며,
          당사자가 첫 로그인에서 새 비밀번호를 설정해야 합니다.
        </Alert>

        {created ? (
          <Alert color="green" icon={<IconCheck size={18} />} title="회원가입을 생성했습니다." role="status">
            {created.alreadyApplied
              ? '같은 요청이 이미 처리되어 기존 결과를 확인했습니다.'
              : '당사자에게 임시 비밀번호와 최초 변경 절차를 안전한 채널로 안내해주세요.'}
          </Alert>
        ) : null}

        {submitError ? (
          <Alert color="red" title="생성하지 못했습니다." role="alert">
            {submitError}
          </Alert>
        ) : null}

        <Paper component="form" onSubmit={handleSubmit} withBorder radius="lg" p={{ base: 'md', md: 'xl' }}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
            <Stack gap="md">
              <Box>
                <Title order={2} size="h4">기본 정보</Title>
                <Text c="dimmed" size="sm">일반 회원가입과 동일한 필수 정보입니다.</Text>
              </Box>

              <TextInput
                ref={nameInputRef}
                required
                label="이름"
                value={form.name}
                onChange={(event) => setField('name', event.currentTarget.value)}
                maxLength={40}
                autoComplete="off"
              />
              <TextInput
                required
                label="휴대폰 번호"
                description="문자 인증 완료로 표시되지 않습니다."
                value={form.phone}
                onChange={(event) => setField('phone', event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 11))}
                inputMode="numeric"
                autoComplete="tel"
              />
              <Select
                required
                searchable
                label="소속"
                data={ADMIN_ASSISTED_AFFILIATION_OPTIONS}
                value={form.affiliation || null}
                onChange={(value) => setField('affiliation', value ?? '')}
                nothingFoundMessage="소속을 찾을 수 없습니다."
              />
              <TextInput
                required
                type="email"
                label="이메일"
                value={form.email}
                onChange={(event) => setField('email', event.currentTarget.value)}
                maxLength={160}
                autoComplete="email"
              />
              <Select
                required
                label="통신사"
                data={ADMIN_ASSISTED_CARRIER_OPTIONS}
                value={form.carrier || null}
                onChange={(value) => setField('carrier', value ?? '')}
              />

              <Checkbox.Group label="보유 자격" description={`현재 선택: ${selectedLicenseLabels}`} required>
                <Group mt="xs">
                  {ADMIN_ASSISTED_LICENSE_OPTIONS.map((option) => (
                    <Checkbox
                      key={option.value}
                      value={option.value}
                      label={option.label}
                      checked={form.licenseStatuses.includes(option.value)}
                      onChange={() => toggleLicense(option.value)}
                    />
                  ))}
                </Group>
              </Checkbox.Group>

              <Divider label="추천인" labelPosition="left" />
              <TextInput
                required
                label="추천인 검색"
                description="가입 완료 FC 또는 활성 본부장만 선택할 수 있습니다."
                placeholder="이름 2자 이상"
                leftSection={<IconSearch size={16} />}
                value={selectedReferral ? selectedReferral.name : referralQuery}
                onChange={(event) => {
                  setSelectedReferral(null);
                  setReferralQuery(event.currentTarget.value);
                }}
                rightSection={searching ? <Text size="xs">검색</Text> : null}
              />

              {searchError ? <Text c="red" size="sm" role="alert">{searchError}</Text> : null}
              {!selectedReferral && referralQuery.trim().length >= 2 && !searching && !searchError ? (
                <Stack gap={6} aria-live="polite">
                  {referralResults.length === 0 ? (
                    <Text c="dimmed" size="sm">검색 결과가 없습니다.</Text>
                  ) : referralResults.map((result) => (
                    <UnstyledButton
                      key={result.fcId}
                      onClick={() => {
                        setSelectedReferral(result);
                        setReferralResults([]);
                        setSearchError(null);
                      }}
                      aria-label={`${result.name}, ${result.affiliation} 추천인 선택`}
                    >
                      <Paper withBorder radius="md" p="sm">
                        <Group justify="space-between" wrap="nowrap">
                          <Box>
                            <Text fw={700}>{result.name}</Text>
                            <Text c="dimmed" size="sm">{result.affiliation}</Text>
                          </Box>
                          <Text c="orange.7" size="xs" fw={700}>{result.code}</Text>
                        </Group>
                      </Paper>
                    </UnstyledButton>
                  ))}
                </Stack>
              ) : null}

              {selectedReferral ? (
                <Paper withBorder radius="md" p="md" bg="orange.0">
                  <Group justify="space-between" align="flex-start">
                    <Box>
                      <Text size="xs" c="orange.8" fw={700}>선택한 추천인</Text>
                      <Text fw={800}>{selectedReferral.name}</Text>
                      <Text c="dimmed" size="sm">{selectedReferral.affiliation}</Text>
                    </Box>
                    <Button
                      type="button"
                      variant="subtle"
                      color="gray"
                      size="compact-sm"
                      onClick={() => {
                        setSelectedReferral(null);
                        setReferralQuery('');
                      }}
                    >
                      다시 선택
                    </Button>
                  </Group>
                </Paper>
              ) : null}
            </Stack>

            <Stack gap="md">
              <Box>
                <Title order={2} size="h4">서면 확인과 임시 자격증명</Title>
                <Text c="dimmed" size="sm">동의서 원문은 저장하지 않고 내부 문서관리번호만 기록합니다.</Text>
              </Box>

              <TextInput
                required
                type="date"
                label="서면 확인일"
                description="오늘부터 90일 이내"
                value={form.consentObtainedOn}
                onChange={(event) => setField('consentObtainedOn', event.currentTarget.value)}
              />
              <TextInput
                required
                label="문서관리번호"
                description="동의서 내용이나 주민번호를 입력하지 마세요."
                placeholder="예: CONSENT-2026-001"
                value={form.evidenceReference}
                onChange={(event) => setField('evidenceReference', event.currentTarget.value)}
                maxLength={64}
                autoComplete="off"
              />
              <PasswordInput
                required
                label="임시 비밀번호"
                description="8자 이상, 영문·숫자·특수문자 포함"
                value={form.password}
                onChange={(event) => setField('password', event.currentTarget.value)}
                maxLength={128}
                autoComplete="new-password"
              />
              <PasswordInput
                required
                label="임시 비밀번호 확인"
                value={form.confirmPassword}
                onChange={(event) => setField('confirmPassword', event.currentTarget.value)}
                maxLength={128}
                autoComplete="new-password"
              />

              <Checkbox
                mt="sm"
                checked={form.consentAttested}
                onChange={(event) => setField('consentAttested', event.currentTarget.checked)}
                label="본인이 서면 동의서를 확인했고, 해당 FC의 회원가입 생성 및 임시 비밀번호 발급에 대한 동의를 확보했습니다."
              />

              <Paper withBorder radius="md" p="md" bg="gray.0" mt="auto">
                <Text size="sm" fw={700}>생성 전 확인</Text>
                <Text size="sm" c="dimmed" mt={4}>
                  생성 후 휴대폰 인증 상태는 미인증으로 유지됩니다. 실행자, 확인일, 문서관리번호와 추천인 변경 근거는 감사 기록에 남습니다.
                </Text>
              </Paper>

              <Button
                type="submit"
                color="orange"
                size="md"
                leftSection={<IconUserPlus size={18} />}
                loading={submitting}
                disabled={!form.consentAttested || !selectedReferral}
              >
                서면확인 회원가입 생성
              </Button>
            </Stack>
          </SimpleGrid>
        </Paper>
      </Stack>
    </Container>
  );
}

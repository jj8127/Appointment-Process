'use client';

import { useSession } from '@/hooks/use-session';
import { Badge, Button, Card, Container, Group, Progress, SimpleGrid, Text, ThemeIcon, Title } from '@mantine/core';
import { IconArrowRight, IconAward, IconCheck, IconFileText, IconLink, IconUser } from '@tabler/icons-react'; // Using tabler icons as they are standard for Mantine
import { useRouter } from 'next/navigation';

// Mock data or logic to determine step
const steps = [
    { key: 'step1', label: '1단계 인적사항', icon: IconUser, link: '/onboarding/step1' },
    { key: 'step2', label: '2단계 수당동의', icon: IconCheck, link: '/onboarding/step2' },
    { key: 'step3', label: '3단계 문서제출', icon: IconFileText, link: '/onboarding/step3' },
    { key: 'step4', label: '4단계 위촉 진행', icon: IconLink, link: '/onboarding/step4' },
    { key: 'step5', label: '5단계 완료', icon: IconAward, link: '/onboarding/step5' },
];

export default function Dashboard() {
    const { role, displayName, logout } = useSession();
    const router = useRouter();

    // TODO: Fetch actual status from Supabase to determine active step
    const currentStepIndex = 0; // Mock: Step 1 active

    return (
        <Container size="md" py="xl">
            <Group justify="space-between" mb="xl">
                <div>
                    <Title order={2}>안녕하세요, {displayName || 'FC'}님</Title>
                    <Text c="dimmed">위촉 진행 현황을 확인하세요.</Text>
                </div>
                <Button variant="outline" color="gray" onClick={logout}>로그아웃</Button>
            </Group>

            <Card withBorder radius="md" p="xl" mb="xl">
                <Text fz="lg" fw={700} mb="md">
                    진행률
                </Text>
                <Progress value={(currentStepIndex / 5) * 100} size="xl" radius="xl" color="orange" />
                <Text ta="right" mt="xs" c="dimmed" size="sm">
                    {currentStepIndex}/5 단계 완료
                </Text>
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                {steps.map((step, index) => {
                    const isActive = index === currentStepIndex;
                    const isCompleted = index < currentStepIndex;

                    return (
                        <Card key={step.key} shadow="sm" padding="lg" radius="md" withBorder>
                            <Group justify="space-between" mb="xs">
                                <ThemeIcon color={isActive ? 'orange' : isCompleted ? 'green' : 'gray'} variant="light" size="lg">
                                    <step.icon size={20} />
                                </ThemeIcon>
                                {isCompleted && <Badge color="green">완료</Badge>}
                                {isActive && <Badge color="orange">진행 중</Badge>}
                            </Group>

                            <Text fw={500} size="lg" mt="md">
                                {step.label}
                            </Text>

                            <Button
                                fullWidth
                                mt="md"
                                variant={isActive ? 'filled' : 'light'}
                                color="orange"
                                disabled={!isActive && !isCompleted}
                                rightSection={<IconArrowRight size={14} />}
                                onClick={() => router.push(step.link)}
                            >
                                {isActive ? '시작하기' : isCompleted ? '다시보기' : '대기 중'}
                            </Button>
                        </Card>
                    );
                })}
            </SimpleGrid>
        </Container>
    );
}

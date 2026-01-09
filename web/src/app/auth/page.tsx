'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
    Button,
    Container,
    Paper,
    Stack,
    Text,
    TextInput,
    Title,
    PasswordInput,
    Box,
    rem,
    Image
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconPhone, IconLock, IconArrowRight } from '@tabler/icons-react';

const HANWHA_ORANGE = '#f36f21';
const HANWHA_ORANGE_DARK = '#d65a16';

export default function AuthPage() {
    const { loginAs, role, residentId, hydrated, displayName } = useSession();
    const [phoneInput, setPhoneInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        if (role === 'admin') {
            router.replace('/');
            return;
        }
        if (role === 'fc' && residentId) {
            if (!displayName?.trim()) {
                router.replace('/fc/new');
            } else {
                router.replace('/');
            }
        }
    }, [hydrated, role, residentId, displayName, router]);

    const handleLogin = async () => {
        const code = phoneInput.trim();
        if (!code) {
            notifications.show({
                title: '알림',
                message: '휴대폰 번호를 입력해주세요.',
                color: 'red',
            });
            return;
        }

        setLoading(true);

        try {
            const digits = code.replace(/[^0-9]/g, '');
            if (digits.length !== 11) {
                notifications.show({
                    title: '알림',
                    message: '휴대폰 번호는 숫자 11자리로 입력해주세요.',
                    color: 'red',
                });
                setLoading(false);
                return;
            }

            if (!passwordInput.trim()) {
                notifications.show({
                    title: '알림',
                    message: '비밀번호를 입력해주세요.',
                    color: 'red',
                });
                setLoading(false);
                return;
            }

            const { data, error } = await supabase.functions.invoke('login-with-password', {
                body: { phone: digits, password: passwordInput.trim() },
            });
            if (error) throw error;
            if (!data?.ok) {
                if ((data?.code === 'needs_password_setup' || data?.code === 'not_found') && data?.role !== 'admin') {
                    notifications.show({
                        title: '안내',
                        message: '계정정보가 없습니다. 회원가입 페이지로 이동합니다.',
                        color: 'orange',
                    });
                    router.replace('/signup');
                    return;
                }
                notifications.show({
                    title: '로그인 실패',
                    message: data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.',
                    color: 'red',
                });
                setLoading(false);
                return;
            }

            const nextRole = data.role === 'admin' ? 'admin' : 'fc';
            loginAs(nextRole, data.residentId ?? digits, data.displayName ?? '');
            if (nextRole === 'admin') {
                router.replace('/');
            } else if (!data.displayName || data.displayName.trim() === '') {
                router.replace('/fc/new');
            } else {
                router.replace('/');
            }
        } catch (err: any) {
            notifications.show({
                title: '로그인 실패',
                message: '오류가 발생했습니다. 다시 시도해주세요.',
                color: 'red',
            });
            setLoading(false);
        }
    };

    return (
        <Box
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #ffffff 0%, #fff1e6 50%, #ffe8d6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: rem(20),
            }}
        >
            <Container size={440} style={{ width: '100%' }}>
                {/* Logo Section */}
                <Box
                    style={{
                        textAlign: 'center',
                        marginBottom: rem(32),
                        opacity: mounted ? 1 : 0,
                        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
                        transition: 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    <Image
                        src="/adminWebLogo.png"
                        alt="FC Onboarding"
                        style={{
                            width: '280px',
                            height: 'auto',
                            maxWidth: '100%',
                            marginBottom: rem(16),
                        }}
                    />
                    <Box
                        style={{
                            width: rem(40),
                            height: rem(4),
                            background: HANWHA_ORANGE,
                            borderRadius: rem(2),
                            opacity: 0.3,
                        }}
                    />
                </Box>

                {/* Login Card */}
                <Paper
                    shadow="xl"
                    p={40}
                    radius="xl"
                    style={{
                        background: 'rgba(255, 255, 255, 0.95)',
                        backdropFilter: 'blur(10px)',
                        border: `1px solid rgba(243, 111, 33, 0.1)`,
                        opacity: mounted ? 1 : 0,
                        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.98)',
                        transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s',
                    }}
                >
                    <Stack gap="lg">
                        {/* Header */}
                        <Box style={{ textAlign: 'center', marginBottom: rem(8) }}>
                            <Title order={2} fw={800} size={rem(28)} c="dark.8" mb={8}>
                                로그인
                            </Title>
                            <Text c="dimmed" size="sm" style={{ lineHeight: 1.6 }}>
                                관리자는 지정된 번호 + 비밀번호
                                <br />
                                FC는 휴대폰 번호 + 비밀번호를 입력해주세요.
                            </Text>
                        </Box>

                        {/* Phone Input */}
                        <TextInput
                            label="휴대폰 번호"
                            placeholder="번호 입력 (- 없이 숫자만)"
                            leftSection={<IconPhone size={18} stroke={1.5} />}
                            size="lg"
                            radius="md"
                            value={phoneInput}
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={11}
                            autoComplete="tel"
                            onChange={(event) => setPhoneInput(event.currentTarget.value.replace(/[^0-9]/g, ''))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleLogin();
                            }}
                            styles={{
                                label: {
                                    fontWeight: 700,
                                    fontSize: rem(14),
                                    color: '#1F2937',
                                    marginBottom: rem(8),
                                },
                                input: {
                                    fontSize: rem(16),
                                    borderWidth: rem(1.5),
                                    transition: 'all 0.2s ease',
                                    '&:focus': {
                                        borderColor: HANWHA_ORANGE,
                                        boxShadow: `0 0 0 3px rgba(243, 111, 33, 0.1)`,
                                    },
                                },
                            }}
                        />

                        {/* Password Input */}
                        <PasswordInput
                            label="비밀번호"
                            placeholder="8자 이상, 영문+숫자+특수문자"
                            leftSection={<IconLock size={18} stroke={1.5} />}
                            size="lg"
                            radius="md"
                            value={passwordInput}
                            onChange={(event) => setPasswordInput(event.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleLogin();
                            }}
                            styles={{
                                label: {
                                    fontWeight: 700,
                                    fontSize: rem(14),
                                    color: '#1F2937',
                                    marginBottom: rem(8),
                                },
                                input: {
                                    fontSize: rem(16),
                                    borderWidth: rem(1.5),
                                    transition: 'all 0.2s ease',
                                    '&:focus': {
                                        borderColor: HANWHA_ORANGE,
                                        boxShadow: `0 0 0 3px rgba(243, 111, 33, 0.1)`,
                                    },
                                },
                            }}
                        />

                        {/* Login Button */}
                        <Button
                            fullWidth
                            size="lg"
                            radius="md"
                            onClick={handleLogin}
                            loading={loading}
                            rightSection={<IconArrowRight size={20} stroke={2} />}
                            style={{
                                background: `linear-gradient(135deg, ${HANWHA_ORANGE} 0%, ${HANWHA_ORANGE_DARK} 100%)`,
                                border: 'none',
                                fontWeight: 700,
                                fontSize: rem(17),
                                height: rem(56),
                                marginTop: rem(8),
                                transition: 'all 0.2s ease',
                                boxShadow: `0 4px 12px rgba(243, 111, 33, 0.3)`,
                            }}
                            styles={{
                                root: {
                                    '&:hover': {
                                        transform: 'translateY(-2px)',
                                        boxShadow: `0 6px 16px rgba(243, 111, 33, 0.4)`,
                                    },
                                    '&:active': {
                                        transform: 'translateY(0)',
                                    },
                                },
                            }}
                        >
                            로그인
                        </Button>

                        {/* Reset Password Link */}
                        <Button
                            variant="subtle"
                            size="md"
                            fullWidth
                            onClick={() => router.push('/reset-password')}
                            style={{
                                color: '#6B7280',
                                fontWeight: 600,
                                fontSize: rem(14),
                            }}
                            styles={{
                                root: {
                                    '&:hover': {
                                        background: 'rgba(243, 111, 33, 0.05)',
                                        color: HANWHA_ORANGE,
                                    },
                                },
                            }}
                        >
                            비밀번호를 잊으셨나요?
                        </Button>
                    </Stack>
                </Paper>

                {/* Footer */}
                <Text
                    size="xs"
                    c="dimmed"
                    ta="center"
                    mt="xl"
                    style={{
                        opacity: mounted ? 0.7 : 0,
                        transition: 'opacity 0.8s ease 0.4s',
                    }}
                >
                    © 2024 FC Onboarding System. All rights reserved.
                </Text>
            </Container>
        </Box>
    );
}

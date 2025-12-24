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
    Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function AuthPage() {
    const { loginAs, role, residentId, hydrated, displayName } = useSession();
    const [phoneInput, setPhoneInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    // 이미 로그인된 세션이 있다면 모바일과 동일하게 즉시 리다이렉트
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
                        message: '비밀번호 설정은 회원가입에서 가능합니다.',
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center" fw={900}>
                FC Onboarding
            </Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                관리자는 지정된 번호 + 비밀번호, FC는 휴대폰 번호 + 비밀번호를 입력해주세요.
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <Stack>
                    <TextInput
                        label="휴대폰 번호"
                        placeholder="휴대폰 번호 (- 없이 숫자만 입력)"
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
                    />
                    <TextInput
                        label="비밀번호"
                        placeholder="8자 이상, 영문+숫자+특수문자"
                        value={passwordInput}
                        type="password"
                        onChange={(event) => setPasswordInput(event.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleLogin();
                        }}
                    />
                    <Button fullWidth onClick={handleLogin} loading={loading} color="orange">
                        시작하기
                    </Button>
                    <Button variant="subtle" color="orange" onClick={() => router.push('/reset-password')}>
                        비밀번호를 잊으셨나요?
                    </Button>
                </Stack>
            </Paper>
        </Container>
    );
}

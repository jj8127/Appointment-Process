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

const ADMIN_PHONE_NUMBERS = (process.env.NEXT_PUBLIC_ADMIN_PHONES ?? '')
    .split(',')
    .map((phone) => phone.replace(/[^0-9]/g, ''))
    .filter(Boolean);

export default function AuthPage() {
    const { loginAs, role, residentId, hydrated, displayName } = useSession();
    const [phoneInput, setPhoneInput] = useState('');
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
            if (code === '1111') {
                loginAs('admin', 'admin', '총무');
                router.replace('/');
                return;
            }

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

            if (ADMIN_PHONE_NUMBERS.includes(digits)) {
                loginAs('admin', digits, '총무');
                router.replace('/');
                return;
            }

            const { data, error } = await supabase
                .from('fc_profiles')
                .select('id,phone,name')
                .eq('phone', digits)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                const { data: inserted, error: insertErr } = await supabase
                    .from('fc_profiles')
                    .insert({
                        phone: digits,
                        name: '',
                        affiliation: '',
                        recommender: '',
                        email: '',
                        address: '',
                        status: 'draft',
                    })
                    .select('phone,name')
                    .single();

                if (insertErr) throw insertErr;
                loginAs('fc', inserted?.phone ?? digits, inserted?.name ?? '');
                router.replace('/fc/new');
            } else {
                loginAs('fc', data.phone ?? digits, data.name ?? '');
                if (!data.name || data.name.trim() === '') {
                    router.replace('/fc/new');
                } else {
                    router.replace('/');
                }
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
                관리자는 코드, FC는 휴대폰 번호를 입력해주세요.
            </Text>

            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <Stack>
                    <TextInput
                        label="휴대폰 번호 / 관리자 코드"
                        placeholder="숫자만 입력"
                        value={phoneInput}
                        onChange={(event) => setPhoneInput(event.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleLogin();
                        }}
                    />
                    <Button fullWidth onClick={handleLogin} loading={loading} color="orange">
                        시작하기
                    </Button>
                </Stack>
            </Paper>
        </Container>
    );
}

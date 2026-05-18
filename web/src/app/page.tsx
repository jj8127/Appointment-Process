'use client';

import { useSession } from '@/hooks/use-session';
import { Center, Loader } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
    const router = useRouter();
    const { hydrated, role } = useSession();

    useEffect(() => {
        if (!hydrated) return;

        if (role === 'admin' || role === 'manager') {
            router.replace('/dashboard');
            return;
        }

        router.replace('/auth');
    }, [hydrated, role, router]);

    return (
        <Center h="100vh">
            <Loader color="orange" />
        </Center>
    );
}

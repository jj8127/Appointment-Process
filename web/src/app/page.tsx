'use client';

import { useSession } from '@/hooks/use-session';
import { Center, Loader } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
    const { hydrated, role } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (!hydrated) return;
        if (!role) {
            router.replace('/auth');
        } else {
            router.replace('/dashboard');
        }
    }, [hydrated, role, router]);

    return (
        <Center h="100vh">
            <Loader color="orange" />
        </Center>
    );
}

'use client';

import { useSession } from '@/hooks/use-session';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && role !== 'admin') {
      router.replace('/auth');
    }
  }, [hydrated, role, router]);

  if (!hydrated || role !== 'admin') return null;

  return <>{children}</>;
}

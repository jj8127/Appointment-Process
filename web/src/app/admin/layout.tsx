'use client';

import { useSession } from '@/hooks/use-session';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role, hydrated } = useSession();

  if (!hydrated || role !== 'admin') return null;

  return <>{children}</>;
}

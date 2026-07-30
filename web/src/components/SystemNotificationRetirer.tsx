'use client';

import { useEffect, useRef } from 'react';

import { useSession } from '@/hooks/use-session';
import { retireBrowserSystemNotifications } from '@/lib/system-notification-retirement';

export function SystemNotificationRetirer() {
  const { hydrated, residentId, role } = useSession();
  const retiredActorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated || !role || !residentId) {
      return;
    }

    const actorKey = `${role}:${residentId}`;
    if (retiredActorRef.current === actorKey) {
      return;
    }
    retiredActorRef.current = actorKey;

    void retireBrowserSystemNotifications();
  }, [hydrated, residentId, role]);

  return null;
}

import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { updateUserPresence } from '@/lib/user-presence-api';

import { useSession } from './use-session';

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useAppPresenceHeartbeat() {
  const { hydrated, residentId, role } = useSession();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPlatformAtRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const queuedActionRef = useRef<'heartbeat' | 'offline' | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const canRun = Platform.OS !== 'web' && hydrated && Boolean(role) && Boolean(residentId);

  const clearHeartbeatLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const performAction = useCallback(async (action: 'heartbeat' | 'offline') => {
    if (!canRun) {
      return;
    }

    if (requestInFlightRef.current) {
      queuedActionRef.current =
        action === 'offline'
          ? 'offline'
          : (queuedActionRef.current ?? 'heartbeat');
      return;
    }

    if (action === 'heartbeat' && appStateRef.current !== 'active') {
      return;
    }

    if (action === 'offline' && !activeRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    try {
      const result = action === 'heartbeat'
        ? await updateUserPresence('heartbeat')
        : await updateUserPresence('offline', { expectedAt: lastPlatformAtRef.current });

      if (result.ok && result.data) {
        lastPlatformAtRef.current =
          result.data.platform_at ?? result.data.garam_in_at ?? result.data.last_seen_at ?? null;

        if (action === 'heartbeat') {
          activeRef.current = true;
        } else if (result.data.applied !== false) {
          activeRef.current = false;
        }
      }
    } finally {
      requestInFlightRef.current = false;

      const queuedAction = queuedActionRef.current;
      if (!queuedAction) {
        return;
      }

      queuedActionRef.current = null;
      const nextAction =
        queuedAction === 'offline' || appStateRef.current !== 'active'
          ? 'offline'
          : 'heartbeat';
      void performAction(nextAction);
    }
  }, [canRun]);

  const startHeartbeatLoop = useCallback(() => {
    clearHeartbeatLoop();

    if (!canRun || appStateRef.current !== 'active') {
      return;
    }

    void performAction('heartbeat');
    intervalRef.current = setInterval(() => {
      void performAction('heartbeat');
    }, HEARTBEAT_INTERVAL_MS);
  }, [canRun, clearHeartbeatLoop, performAction]);

  useEffect(() => {
    if (!canRun) {
      clearHeartbeatLoop();
      activeRef.current = false;
      lastPlatformAtRef.current = null;
      queuedActionRef.current = null;
      return;
    }

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appStateRef.current = nextAppState;

      if (nextAppState === 'active') {
        startHeartbeatLoop();
        return;
      }

      clearHeartbeatLoop();
      void performAction('offline');
    };

    handleAppStateChange(AppState.currentState);

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      clearHeartbeatLoop();
      subscription.remove();
    };
  }, [canRun, clearHeartbeatLoop, performAction, startHeartbeatLoop]);
}

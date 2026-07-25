import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  markPendingNotificationRead,
  parseNotificationReceiptHandoff,
  type NotificationReceiptParams,
} from './notification-receipt';
import {
  parseNotificationTarget,
  serializeNotificationTarget,
  type NotificationTarget,
} from './notification-target';

export type NotificationDestinationLoadState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error';

export type NotificationReceiptCompletionState =
  | 'inactive'
  | 'waiting'
  | 'marking'
  | 'complete'
  | 'target_unavailable'
  | 'mark_failed';

export function useNotificationReceiptCompletion(input: {
  params: NotificationReceiptParams;
  expectedTarget: NotificationTarget | null;
  loadState: NotificationDestinationLoadState;
}) {
  const {
    notificationId,
    notificationTarget,
  } = input.params;
  const handoff = useMemo(
    () => parseNotificationReceiptHandoff({
      notificationId,
      notificationTarget,
    }),
    [notificationId, notificationTarget],
  );
  const expectedTargetFingerprint = input.expectedTarget
    ? serializeNotificationTarget(input.expectedTarget)
    : '';
  const expectedTarget = useMemo(
    () => parseNotificationTarget(expectedTargetFingerprint),
    [expectedTargetFingerprint],
  );
  const [state, setState] =
    useState<NotificationReceiptCompletionState>(
      handoff ? 'waiting' : 'inactive',
    );
  const attemptRef = useRef(0);
  const completedHandoffRef = useRef('');
  const handoffFingerprint = handoff
    ? `${handoff.notificationId}:${serializeNotificationTarget(handoff.target)}`
    : '';

  const attemptMarkRead = useCallback(async () => {
    if (!handoff || !expectedTarget) return;
    if (completedHandoffRef.current === handoffFingerprint) {
      setState('complete');
      return;
    }
    const currentAttempt = attemptRef.current + 1;
    attemptRef.current = currentAttempt;
    setState('marking');
    const result = await markPendingNotificationRead({
      handoff,
      expectedTarget,
    });
    if (attemptRef.current !== currentAttempt) return;
    if (result.ok) {
      completedHandoffRef.current = handoffFingerprint;
      setState('complete');
      return;
    }
    setState(
      result.reason === 'request_failed'
        ? 'mark_failed'
        : 'target_unavailable',
    );
  }, [expectedTarget, handoff, handoffFingerprint]);

  useEffect(() => {
    if (!handoff) {
      setState('inactive');
      return;
    }
    if (completedHandoffRef.current === handoffFingerprint) {
      setState('complete');
      return;
    }
    if (input.loadState === 'error') {
      setState('target_unavailable');
      return;
    }
    if (input.loadState !== 'success' || !expectedTarget) {
      setState('waiting');
      return;
    }
    void attemptMarkRead();
  }, [
    attemptMarkRead,
    expectedTarget,
    handoff,
    handoffFingerprint,
    input.loadState,
  ]);

  return {
    state,
    retryMarkRead: attemptMarkRead,
    hasReceiptHandoff: Boolean(handoff),
  };
}

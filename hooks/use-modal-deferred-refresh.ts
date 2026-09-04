import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

import { logger } from '@/lib/logger';

/**
 * Refresh a screen only after all of its native modals have closed.
 * Android callers must use animationType="none": React Native does not expose
 * an Android onDismiss event or register native dialog animations with IM.
 * Callers must check canCommit after each await before applying refresh state.
 */
export function useModalDeferredRefresh({
  visibleModal,
  refresh,
}: {
  visibleModal: string | null;
  refresh: (canCommit: () => boolean) => Promise<void>;
}) {
  const [requested, setRequested] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [dismissalRevision, setDismissalRevision] = useState(0);
  const visibleModalRef = useRef(visibleModal);
  const nativeModals = useRef(new Set<string>());

  useLayoutEffect(() => {
    visibleModalRef.current = visibleModal;
    if (Platform.OS === 'ios' && visibleModal !== null) {
      nativeModals.current.add(visibleModal);
    }
  }, [visibleModal]);

  const requestRefresh = useCallback(() => setRequested((value) => value + 1), []);
  const canOpenModal = useCallback(() => (
    visibleModalRef.current === null
    && (Platform.OS !== 'ios' || nativeModals.current.size === 0)
  ), []);
  const onModalDismiss = useCallback((modal: string) => {
    if (visibleModalRef.current === modal) return;
    if (nativeModals.current.delete(modal)) {
      setDismissalRevision((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    if (visibleModal !== null || requested === completed || !canOpenModal()) return;

    let cancelled = false;
    let frame: number | undefined;
    const canCommit = () => !cancelled && canOpenModal();
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (!canCommit()) return;
      frame = requestAnimationFrame(() => {
        if (!canCommit()) return;
        void refresh(canCommit)
          .catch((error: unknown) => {
            if (canCommit()) logger.warn('[modal-refresh] refresh failed', error);
          })
          .finally(() => {
            if (canCommit()) setCompleted(requested);
          });
      });
    });

    return () => {
      cancelled = true;
      interaction.cancel();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [canOpenModal, completed, dismissalRevision, refresh, requested, visibleModal]);

  return { requestRefresh, onModalDismiss, canOpenModal };
}

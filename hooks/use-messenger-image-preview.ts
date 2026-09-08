import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '@/hooks/use-session';
import { createMessengerAttachmentPreviewUrl } from '@/lib/messenger-attachment-api';

type PreviewState = {
  request: object;
  url: string | null;
  loading: boolean;
  failed: boolean;
  visible: boolean;
};

// Bound private URL requests when a history page contains many photos. Queued
// work checks its session/route again before contacting the server.
let inFlight = 0;
const waiting: (() => void)[] = [];
function scheduleImageRequest<T>(run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      void run().then(resolve, reject).finally(() => {
        inFlight -= 1;
        waiting.shift()?.();
      });
    };
    if (inFlight < 4) start();
    else waiting.push(start);
  });
}

export function useMessengerImagePreview(attachmentId: string) {
  const { appSessionToken } = useSession();
  const focused = useIsFocused();
  const request = useMemo(() => ({ attachmentId, appSessionToken, focused }), [attachmentId, appSessionToken, focused]);
  const activeRequest = useRef<object | null>(null);
  const sequence = useRef(0);
  const [state, setState] = useState<PreviewState | null>(null);

  const load = useCallback(async (visible = false) => {
    if (!appSessionToken || !focused || activeRequest.current !== request) return;
    const currentSequence = ++sequence.current;
    setState((previous) => ({
      request,
      url: previous?.request === request ? previous.url : null,
      loading: true,
      failed: false,
      visible: false,
    }));
    try {
      const result = await scheduleImageRequest(async () => {
        if (activeRequest.current !== request || sequence.current !== currentSequence) return null;
        return createMessengerAttachmentPreviewUrl(attachmentId, appSessionToken);
      });
      if (!result) return;
      if (activeRequest.current !== request || sequence.current !== currentSequence) return;
      setState({ request, url: result.signedUrl, loading: false, failed: false, visible });
    } catch {
      if (activeRequest.current !== request || sequence.current !== currentSequence) return;
      setState({ request, url: null, loading: false, failed: true, visible: false });
    }
  }, [appSessionToken, attachmentId, focused, request]);

  useEffect(() => {
    activeRequest.current = request;
    void load();
    return () => { activeRequest.current = null; };
  }, [load, request]);

  const current = appSessionToken && focused && state?.request === request ? state : null;
  return {
    url: current?.url ?? null,
    loading: current?.loading ?? Boolean(appSessionToken && focused),
    failed: current?.failed ?? !appSessionToken,
    visible: current?.visible ?? false,
    retry: () => { void load(); },
    // Reauthorize every full-screen open, including after a URL has expired.
    open: () => { void load(true); },
    close: () => setState((previous) => previous ? { ...previous, visible: false } : null),
    imageFailed: () => setState((previous) => previous?.request === request && previous.url === current?.url
      ? { ...previous, url: null, loading: false, failed: true, visible: false } : previous),
  };
}

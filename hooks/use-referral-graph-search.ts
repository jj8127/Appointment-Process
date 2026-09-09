import { useCallback, useEffect, useRef, useState } from 'react';

const SEARCH_DELAY_MS = 180;

/** Keep typing immediate while coalescing graph work until the user pauses. */
export function useReferralGraphSearch() {
  const [searchTerm, setDraft] = useState('');
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const draft = useRef('');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (pending.current != null) clearTimeout(pending.current);
    pending.current = null;
  }, []);

  const setSearchTerm = useCallback((value: string) => {
    cancelPending();
    draft.current = value;
    setDraft(value);
    if (value === '') {
      setAppliedSearchTerm('');
      return;
    }
    pending.current = setTimeout(() => {
      pending.current = null;
      setAppliedSearchTerm(value);
    }, SEARCH_DELAY_MS);
  }, [cancelPending]);

  const flushSearchTerm = useCallback(() => {
    cancelPending();
    setAppliedSearchTerm(draft.current);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  return { searchTerm, appliedSearchTerm, setSearchTerm, flushSearchTerm };
}

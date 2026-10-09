import { useCallback, useEffect, useRef } from 'react';

/** A delayed response cannot replace a newer read or a remounted session owner. */
export function useReadAttempt() {
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current += 1; };
  }, []);
  return useCallback(() => {
    const attempt = ++sequence.current;
    return () => mounted.current && sequence.current === attempt;
  }, []);
}

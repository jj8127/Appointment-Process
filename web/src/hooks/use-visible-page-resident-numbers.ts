'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  fetchResidentNumbersFull,
} from '@/lib/resident-number-client';
import {
  createVisiblePageResidentNumberScope,
  failVisiblePageResidentNumbers,
  resolveVisiblePageResidentNumbers,
  selectVisiblePageResidentNumberCells,
  type ResolvedVisiblePageResidentNumbers,
} from '@/lib/resident-number-visible-page-state';

type UseVisiblePageResidentNumbersOptions = {
  fcIds: string[];
  enabled: boolean;
  resetKey: string;
};

export function useVisiblePageResidentNumbers({
  fcIds,
  enabled,
  resetKey,
}: UseVisiblePageResidentNumbersOptions) {
  const scope = useMemo(
    () => createVisiblePageResidentNumberScope({ fcIds, enabled, resetKey }),
    [enabled, fcIds, resetKey],
  );
  const [resolved, setResolved] = useState<ResolvedVisiblePageResidentNumbers>({
    scopeKey: '',
    cells: {},
  });

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setResolved({ scopeKey: scope.key, cells: scope.initialCells });
    });

    if (!scope.shouldFetch) {
      return () => {
        active = false;
      };
    }

    const abortController = new AbortController();

    void fetchResidentNumbersFull(scope.fcIds, abortController.signal)
      .then((residentNumbers) => {
        if (!active) return;
        setResolved(resolveVisiblePageResidentNumbers(scope, residentNumbers));
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setResolved(failVisiblePageResidentNumbers(scope));
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, [scope]);

  return selectVisiblePageResidentNumberCells(scope, resolved);
}

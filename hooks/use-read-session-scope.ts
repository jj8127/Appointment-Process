import { useMemo } from 'react';

import { useSession } from './use-session';

let nextScope = 0;

/** Never put a signed token in a query key or let renewed sessions reuse old reads. */
export function useReadSessionScope() {
  const { hydrated, role, readOnly, residentId, appSessionToken } = useSession();
  return useMemo(() => ({ hydrated, role, readOnly, residentId, appSessionToken, scope: ++nextScope }),
    [hydrated, role, readOnly, residentId, appSessionToken]).scope;
}

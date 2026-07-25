import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath: string) =>
  readFile(new URL(relativePath, import.meta.url), 'utf8');

test('resident-number list route keeps both direct and Edge reads encrypted-only', async () => {
  const [routeSource, serverSource, sessionSource, edgeSource] = await Promise.all([
    readSource('../app/api/admin/resident-numbers/route.ts'),
    readSource('./server-resident-numbers.ts'),
    readSource('./server-session.ts'),
    readSource('../../../supabase/functions/admin-action/index.ts'),
  ]);

  assert.match(routeSource, /readResidentNumbersWithFallback/);
  assert.match(routeSource, /private, no-cache, no-store/);
  assert.match(routeSource, /allowedRoles: \['admin', 'manager'\]/);
  assert.match(routeSource, /requireActive: true/);
  assert.match(sessionSource, /data\.staff_type === 'developer'/);
  assert.match(serverSource, /\.from\('fc_identity_secure'\)/);
  assert.match(serverSource, /\.select\('fc_id,resident_number_encrypted'\)/);
  assert.match(serverSource, /readResidentNumbersFromEdgeFallback/);
  assert.match(edgeSource, /action === 'getResidentNumbers'/);
  assert.match(edgeSource, /\.from\('fc_identity_secure'\)/);
  assert.match(edgeSource, /\.select\('fc_id,resident_number_encrypted'\)/);
});

test('visible-page client uses one body-only no-store request without persistent query state', async () => {
  const [clientSource, hookSource, stateSource, dashboardSource] = await Promise.all([
    readSource('./resident-number-client.ts'),
    readSource('../hooks/use-visible-page-resident-numbers.ts'),
    readSource('./resident-number-visible-page-state.ts'),
    readSource('../app/dashboard/page.tsx'),
  ]);

  assert.match(clientSource, /cache: 'no-store'/);
  assert.match(clientSource, /body: JSON\.stringify\(\{ fcIds: normalizedFcIds \}\)/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(hookSource, /useQuery|queryClient|localStorage|sessionStorage|logger|Sentry/);
  assert.match(hookSource, /abortController\.abort\(\)/);
  assert.match(hookSource, /selectVisiblePageResidentNumberCells\(scope, resolved\)/);
  assert.match(stateSource, /resolved\.scopeKey === scope\.key/);
  assert.match(dashboardSource, /const ITEMS_PER_PAGE = 20/);
  assert.match(dashboardSource, /paginatedData\.map\(\(fc: FCProfileWithDocuments\) => fc\.id\)/);
});

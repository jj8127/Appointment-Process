import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildFcDocWorkflowResetPayload,
  isFcStatus,
  parseFcStatusUpdateExtra,
} from '../../../lib/fc-status.ts';

test('FC statuses use one strict canonical runtime contract', () => {
  assert.equal(isFcStatus('allowance-consented'), true);
  assert.equal(isFcStatus('final-link-sent'), true);
  assert.equal(isFcStatus('unknown'), false);
  assert.equal(isFcStatus(' final-link-sent '), false);
});

test('status updates accept only fields owned by that transition', () => {
  assert.deepEqual(
    parseFcStatusUpdateExtra('allowance-consented', {
      status: 'allowance-consented',
      allowance_date: '2026-10-13',
    }),
    { allowance_date: '2026-10-13' },
  );
  assert.deepEqual(parseFcStatusUpdateExtra('final-link-sent', undefined), {});
  assert.equal(
    parseFcStatusUpdateExtra('allowance-consented', { resident_id_masked: 'sensitive' }),
    null,
  );
  assert.equal(
    parseFcStatusUpdateExtra('allowance-consented', { status: 'draft' }),
    null,
  );
  assert.equal(parseFcStatusUpdateExtra('unknown', {}), null);
});

test('document workflow reset payload and boolean fields share the same allowlist', () => {
  const reset = buildFcDocWorkflowResetPayload();
  assert.equal(reset.hanwha_commission_pdf_path, null);
  assert.equal(reset.life_commission_completed, false);
  assert.deepEqual(parseFcStatusUpdateExtra('docs-pending', reset), reset);
  assert.equal(
    parseFcStatusUpdateExtra('docs-pending', { life_commission_completed: 'false' }),
    null,
  );
});

test('admin web and Edge status mutations reuse the shared status contract', () => {
  const webRoute = readFileSync(new URL('../app/api/admin/fc/route.ts', import.meta.url), 'utf8');
  const edgeRoute = readFileSync(
    new URL('../../../supabase/functions/admin-action/index.ts', import.meta.url),
    'utf8',
  );
  for (const source of [webRoute, edgeRoute]) {
    assert.match(source, /isFcStatus/);
    assert.match(source, /parseFcStatusUpdateExtra/);
  }
  assert.doesNotMatch(edgeRoute, /\.select\('\*'\)/);
});

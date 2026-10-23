import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadAnswerMapper() {
  const source = readFileSync(new URL('./care-request-admin.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === 'zod') return require('zod');
      if (id === '@shared/lib/hospital-care-queue') return require('../../../lib/hospital-care-queue.ts');
      throw new Error(`Missing care answer mock: ${id}`);
    },
  });
  const map = exports.toPlatformCareAnswer as (input: unknown) => unknown;
  // Results come from another realm; compare plain copies.
  return (input: unknown) => JSON.parse(JSON.stringify(map(input))) as { ok: boolean; payload?: Record<string, unknown>; error?: string };
}

const requestId = '30000000-0000-4000-8000-000000000001';

test('admin web care answers map only to the two staff platform actions', () => {
  const toPlatformCareAnswer = loadAnswerMapper();
  assert.deepEqual(toPlatformCareAnswer({ action: 'respond', requestId, status: 'confirmed', note: ' ' }),
    { ok: true, payload: { action: 'respond_hospital_care', requestId, status: 'confirmed', note: null } });
  assert.deepEqual(toPlatformCareAnswer({ action: 'mark', requestId, milestone: 'first_contact' }),
    { ok: true, payload: { action: 'mark_hospital_care', requestId, milestone: 'first_contact' } });
  // Adjusted and declined answers tell the member why, so an empty note is rejected before platform-service.
  assert.equal(toPlatformCareAnswer({ action: 'respond', requestId, status: 'declined', note: '  ' }).ok, false);
  assert.deepEqual(toPlatformCareAnswer({ action: 'respond', requestId, status: 'adjusted', note: ' 26일 가능 ' }).payload,
    { action: 'respond_hospital_care', requestId, status: 'adjusted', note: '26일 가능' });
  for (const forged of [
    { action: 'respond', requestId, status: 'cancelled', note: '' },
    { action: 'mark', requestId, milestone: 'paid' },
    { action: 'respond', requestId: 'not-a-uuid', status: 'confirmed', note: '' },
    { action: 'respond', requestId, status: 'confirmed', note: 'x'.repeat(501) },
    { action: 'save_partner', requestId },
    { action: 'mark', requestId, milestone: 'first_contact', adminId: 'forged' },
    null,
  ]) assert.equal(toPlatformCareAnswer(forged).ok, false, JSON.stringify(forged));
});

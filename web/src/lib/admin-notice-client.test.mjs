import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import { QueryReadError } from './query-read-error.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadClient(fetchImpl) {
  const source = readFileSync(new URL('./admin-notice-client.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    fetch: fetchImpl,
    require: (id) => {
      if (id === '@/lib/query-read-error') return { QueryReadError };
      if (id === '@/lib/user-intent-policy') return {
        isHttpsResponseUrl(value) {
          if (typeof value !== 'string' || value.trim().length === 0) return false;
          try {
            const parsed = new URL(value);
            return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
          } catch {
            return false;
          }
        },
        requireMutationSuccess(value) {
          if (!value || typeof value !== 'object' || value.ok !== true) throw new Error('mutation_failed');
          return value;
        },
      };
      throw new Error(`Unexpected notice client dependency ${id}`);
    },
  });
  return exports;
}

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const notice = {
  id: 'notice-1',
  title: '공지',
  body: '내용',
  category: null,
  created_at: '2026-10-13T00:00:00.000Z',
  created_by: null,
  images: [],
  files: [],
};

test('shared notice client accepts complete detail and list contracts', async () => {
  const client = loadClient(async (url) => response(
    String(url).includes('?id=') ? { ok: true, notice } : { ok: true, notices: [notice] },
  ));
  assert.equal(JSON.stringify(await client.fetchAdminNotice('notice-1')), JSON.stringify(notice));
  assert.equal(JSON.stringify(await client.fetchAdminNotices()), JSON.stringify([notice]));

  const legacyEmptyBody = { ...notice, title: '', body: '' };
  const legacyClient = loadClient(async () => response({ ok: true, notices: [legacyEmptyBody] }));
  assert.equal(JSON.stringify(await legacyClient.fetchAdminNotices()), JSON.stringify([legacyEmptyBody]));
});

test('shared notice client rejects malformed success responses instead of empty content', async () => {
  for (const body of [
    { ok: true, notice: {} },
    { ok: true, notice: { ...notice, title: 7 } },
    { ok: true, notice: { ...notice, category: undefined } },
    { ok: true, notice: { ...notice, created_at: undefined } },
    { ok: true, notice: { ...notice, created_by: undefined } },
    { ok: true, notice: { ...notice, images: undefined } },
    { ok: true, notice: { ...notice, images: ['javascript:alert(1)'] } },
    { ok: true, notice: { ...notice, images: ['data:image/png;base64,AA=='] } },
    { ok: true, notice: { ...notice, files: undefined } },
    { ok: true, notice: { ...notice, files: [{ name: 'x', url: 'javascript:alert(1)' }] } },
    { ok: true, notice: { ...notice, files: [{ name: 'x', url: 'http://example.com/x' }] } },
    { ok: true, notices: [{}] },
  ]) {
    const client = loadClient(async () => response(body));
    const operation = 'notice' in body ? client.fetchAdminNotice('notice-1') : client.fetchAdminNotices();
    await assert.rejects(operation, (error) => error instanceof QueryReadError);
  }
});

test('shared notice client preserves HTTP status and hides response text', async () => {
  const client = loadClient(async () => response({ error: 'private database detail' }, 401));
  await assert.rejects(
    client.fetchAdminNotice('notice-1'),
    (error) => error instanceof QueryReadError && error.status === 401,
  );
});

test('shared notice deletion requires a receipt for the requested id', async () => {
  const client = loadClient(async (_url, init) => {
    const { id } = JSON.parse(init.body);
    return response({ ok: true, deletedId: id, cleanupWarning: false });
  });
  assert.equal((await client.deleteAdminNotice('notice-1')).deletedId, 'notice-1');

  for (const payload of [
    { ok: true, cleanupWarning: false },
    { ok: true, deletedId: 'notice-other', cleanupWarning: false },
    { ok: true, deletedId: 'notice-1', cleanupWarning: 'false' },
  ]) {
    const malformedClient = loadClient(async () => response(payload));
    await assert.rejects(
      malformedClient.deleteAdminNotice('notice-1'),
      /삭제 결과를 확인하지 못했습니다/,
    );
  }
});

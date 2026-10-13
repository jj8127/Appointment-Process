import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  BOARD_FUNCTION_NAMES,
  buildBoardFunctionHeaders,
  getBoardFunctionUrl,
  normalizeBoardProxyRequest,
  sanitizeBoardUpstreamError,
} = require('./board-web-proxy.ts') as typeof import('./board-web-proxy');

const verifiedManager = {
  role: 'manager' as const,
  residentId: '01011112222',
  displayName: 'Verified Manager',
};

describe('admin web board proxy', () => {
  it('uses the exact deployed board function allowlist', () => {
    assert.deepEqual([...BOARD_FUNCTION_NAMES].sort(), [
      'board-attachment-delete',
      'board-attachment-finalize',
      'board-attachment-sign',
      'board-categories-list',
      'board-category-create',
      'board-category-update',
      'board-comment-create',
      'board-comment-delete',
      'board-comment-like-toggle',
      'board-comment-update',
      'board-create',
      'board-delete',
      'board-detail',
      'board-list',
      'board-notification-retry',
      'board-pin',
      'board-reaction-toggle',
      'board-update',
    ].sort());

    assert.deepEqual(
      normalizeBoardProxyRequest({ functionName: 'delete-account', body: {} }, verifiedManager),
      {
        ok: false,
        status: 400,
        code: 'unsupported_board_function',
        message: 'Unsupported board function',
      },
    );
  });

  it('overwrites forged client actor claims with the verified server actor', () => {
    assert.deepEqual(normalizeBoardProxyRequest({
      functionName: 'board-create',
      body: {
        actor: {
          role: 'admin',
          residentId: '01099998888',
          displayName: 'Forged Admin',
        },
        categoryId: 'general',
        title: 'title',
        content: 'content',
      },
    }, verifiedManager), {
      ok: true,
      functionName: 'board-create',
      payload: {
        actor: verifiedManager,
        categoryId: 'general',
        title: 'title',
        content: 'content',
      },
    });
  });

  it('builds only the selected board URL and server-side Edge headers', () => {
    assert.equal(
      getBoardFunctionUrl('https://example.supabase.co/', 'board-list'),
      'https://example.supabase.co/functions/v1/board-list',
    );
    assert.deepEqual(buildBoardFunctionHeaders('service-role', 'app-session'), {
      'Content-Type': 'application/json',
      apikey: 'service-role',
      Authorization: 'Bearer service-role',
      'x-app-session-token': 'app-session',
    });
  });

  it('keeps browser calls on the same-origin proxy and app tokens out of login JSON', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const boardApiSource = readFileSync(resolve(testDir, 'board-api.ts'), 'utf8');
    const routeSource = readFileSync(resolve(testDir, '../app/api/board/route.ts'), 'utf8');
    const loginRouteSource = readFileSync(resolve(testDir, '../app/api/auth/login/route.ts'), 'utf8');

    assert.match(boardApiSource, /fetch\(\s*['"]\/api\/board['"]/);
    assert.doesNotMatch(boardApiSource, /supabase\.functions\.invoke/);
    assert.doesNotMatch(boardApiSource, /SUPABASE_SERVICE_ROLE_KEY/);

    assert.match(routeSource, /verifyOrigin/);
    assert.match(routeSource, /getVerifiedServerSession/);
    assert.match(routeSource, /checkRateLimit/);
    assert.match(routeSource, /WEB_APP_SESSION_COOKIE/);
    assert.match(routeSource, /createWebGroupChatAppSessionToken/);
    assert.match(routeSource, /SUPABASE_SERVICE_ROLE_KEY/);

    assert.match(loginRouteSource, /const rawAppSessionToken\s*=\s*loginData\.appSessionToken/);
    assert.match(loginRouteSource, /delete publicLoginData\.appSessionToken/);
    assert.match(loginRouteSource, /NextResponse\.json\(publicLoginData/);
    assert.doesNotMatch(loginRouteSource, /NextResponse\.json\(data\s*(?:\?\?|\))/);
  });

  it('never reflects upstream private error messages to the browser', () => {
    const privateFailure = sanitizeBoardUpstreamError({
      ok: false,
      code: 'db_error',
      message: 'private relation and policy detail',
    }, 500);
    assert.deepEqual(privateFailure, {
      body: {
        ok: false,
        code: 'board_upstream_failed',
        message: '게시판 요청을 처리하지 못했습니다.',
      },
      status: 502,
      upstreamCode: 'db_error',
    });
    assert.doesNotMatch(JSON.stringify(privateFailure.body), /private relation|policy detail/);

    assert.deepEqual(
      sanitizeBoardUpstreamError({ ok: false, code: 'file_limit', message: 'untrusted text' }, 400),
      {
        body: {
          ok: false,
          code: 'file_limit',
          message: '첨부 파일 개수 또는 크기를 확인해주세요.',
        },
        status: 400,
        upstreamCode: 'file_limit',
      },
    );
    assert.deepEqual(
      sanitizeBoardUpstreamError({ ok: false, code: 'unknown_private_code', message: 'secret' }, 409),
      {
        body: {
          ok: false,
          code: 'board_upstream_rejected',
          message: '게시판 요청을 처리하지 못했습니다.',
        },
        status: 409,
        upstreamCode: 'unknown_private_code',
      },
    );
  });
});

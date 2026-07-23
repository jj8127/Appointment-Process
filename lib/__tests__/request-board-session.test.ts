import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canUseRequestBoardSession,
  deriveRequestBoardFlags,
  shouldForceRequestBoardRelogin,
} from '@/lib/request-board-session';

describe('request board session helpers', () => {
  it('allows FC and read-only admin sessions to use request_board', () => {
    expect(canUseRequestBoardSession('fc', false, null)).toBe(true);
    expect(canUseRequestBoardSession('admin', true, null)).toBe(true);
    expect(canUseRequestBoardSession('admin', false, 'developer')).toBe(true);
    expect(canUseRequestBoardSession('admin', false, null)).toBe(false);
    expect(canUseRequestBoardSession(null, false, null)).toBe(false);
  });

  it('marks only FC-side designer bridge users as request-board designers', () => {
    expect(deriveRequestBoardFlags('fc', 'designer')).toEqual({
      requestBoardRole: 'designer',
      isRequestBoardDesigner: true,
    });
    expect(deriveRequestBoardFlags('admin', 'designer')).toEqual({
      requestBoardRole: 'designer',
      isRequestBoardDesigner: false,
    });
    expect(deriveRequestBoardFlags('fc', 'fc')).toEqual({
      requestBoardRole: 'fc',
      isRequestBoardDesigner: false,
    });
  });

  it('forces relogin when authenticated request_board session has no recovery token', () => {
    expect(
      shouldForceRequestBoardRelogin({
        authenticated: true,
        hasBridgeToken: false,
        hasAppSessionToken: false,
      }),
    ).toBe(true);

    expect(
      shouldForceRequestBoardRelogin({
        authenticated: true,
        hasBridgeToken: true,
        hasAppSessionToken: false,
      }),
    ).toBe(false);

    expect(
      shouldForceRequestBoardRelogin({
        authenticated: false,
        hasBridgeToken: false,
        hasAppSessionToken: false,
      }),
    ).toBe(false);
  });

  it('registers designer devices as manager tokens from the global session owner with bounded retries', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'hooks', 'use-session.tsx'), 'utf8');

    expect(source).toContain("state.requestBoardRole === 'designer'");
    expect(source).toContain("? 'manager'");
    expect(source).toContain('const retryDelaysMs = [1000, 2000, 5000, 10000] as const');
    expect(source).toContain('if (result.ok || !result.retryable)');
    expect(source).toContain('lastPushRegistrationKeyRef.current = pushRegistrationKey');
  });
});

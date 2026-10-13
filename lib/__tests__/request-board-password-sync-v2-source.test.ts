import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const V2_URL_ENV = "getEnv('REQUEST_BOARD_PASSWORD_SYNC_V2_URL')";
const V2_REQUIRED_ENV = "getEnv('REQUEST_BOARD_PASSWORD_SYNC_V2_REQUIRED')";

describe('Request Board password-sync v2 FC senders', () => {
  it.each([
    'supabase/functions/set-password/index.ts',
    'supabase/functions/complete-assisted-password/index.ts',
    'supabase/functions/login-with-password/index.ts',
    'supabase/functions/reset-password/index.ts',
  ])('%s carries the generation-bound v2 configuration', (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain(V2_URL_ENV);
    expect(source).toContain(V2_REQUIRED_ENV);
    expect(source).toContain('buildFcPasswordSyncUpstream');
    expect(source).toContain('syncV2Url: requestBoardPasswordSyncV2Url');
    expect(source).toContain('requireV2: requestBoardPasswordSyncV2Required');
  });

  it('replays the current FC credential generation on every successful login', () => {
    const source = read('supabase/functions/login-with-password/index.ts');
    const fcBranch = source.slice(source.indexOf(".from('fc_profiles')"));
    expect(fcBranch).toContain(".select('password_hash,password_salt,failed_count,locked_until,password_set_at,must_change_password,session_version')");
    expect(fcBranch).toContain('upstream: buildFcPasswordSyncUpstream(profile.id, creds.session_version)');
    expect(fcBranch).toContain("syncReason: 'login'");
  });

  it('uses the generation returned atomically with each password mutation', () => {
    const setPassword = read('supabase/functions/set-password/index.ts');
    const assisted = read('supabase/functions/complete-assisted-password/index.ts');
    const reset = read('supabase/functions/reset-password/index.ts');

    expect(setPassword).toContain('result.sessionVersion');
    expect(setPassword).not.toContain(".select('session_version')");
    expect(assisted).toContain("'complete_admin_assisted_password_change_v2'");
    expect(assisted).toContain('result.sessionVersion');
    expect(assisted).not.toContain(".select('session_version')");
    expect(reset).toContain('challengeResult.sessionVersion');
    expect(reset).not.toContain(".select('session_version')");
    for (const source of [setPassword, assisted, reset]) {
      expect(source).toContain('buildFcPasswordSyncUpstream(');
    }
  });

  it('keeps non-FC reset accounts on the existing v1 bridge', () => {
    const source = read('supabase/functions/reset-password/index.ts');
    expect(source).toContain("...(account.kind === 'fc'");
    expect(source).toContain("upstream: account.kind === 'fc'");
  });
});

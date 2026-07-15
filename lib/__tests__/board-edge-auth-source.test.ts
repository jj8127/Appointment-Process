import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const functionsRoot = path.join(repoRoot, 'supabase', 'functions');

const expectedBoardFunctions = [
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
  'board-pin',
  'board-reaction-toggle',
  'board-update',
] as const;

describe('board Edge signed-session source contract', () => {
  it('keeps every board endpoint behind the request-bound actor verifier', () => {
    const actual = fs.readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('board-'))
      .map((entry) => entry.name)
      .sort();
    expect(actual).toEqual([...expectedBoardFunctions].sort());

    for (const functionName of expectedBoardFunctions) {
      const source = fs.readFileSync(
        path.join(functionsRoot, functionName, 'index.ts'),
        'utf8',
      );
      expect(`${functionName}\n${source}`).toContain(
        `requireActor(req, body, '${functionName}', origin)`,
      );
      expect(`${functionName}\n${source}`).not.toContain('requireActor(body, origin)');
    }
  });

  it('authenticates the signed app session before any service-role actor lookup', () => {
    const source = fs.readFileSync(
      path.join(functionsRoot, '_shared', 'board.ts'),
      'utf8',
    );
    const authIndex = source.indexOf('await requireAppSessionFromRequest(req)');
    const accountLookupIndex = source.indexOf(".from('admin_accounts')", authIndex);
    const automationVerifyIndex = source.indexOf('verifyBoardAutomationToken');
    const automationLookupIndex = source.indexOf(".from('admin_accounts')");

    expect(source).toContain('x-app-session-token');
    expect(source).toContain('x-board-automation-token');
    expect(source).toContain(".eq('active', true)");
    expect(source).toContain(".select('id,name,phone,signup_completed')");
    expect(source).toContain('data.signup_completed !== true');
    expect(source).toContain('buildVerifiedBoardActor');
    expect(automationVerifyIndex).toBeGreaterThanOrEqual(0);
    expect(automationVerifyIndex).toBeLessThan(automationLookupIndex);
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(authIndex).toBeLessThan(accountLookupIndex);
  });

  it('binds attachment signing and finalization to post ownership and uploaded objects', () => {
    const signSource = fs.readFileSync(
      path.join(functionsRoot, 'board-attachment-sign', 'index.ts'),
      'utf8',
    );
    const finalizeSource = fs.readFileSync(
      path.join(functionsRoot, 'board-attachment-finalize', 'index.ts'),
      'utf8',
    );

    for (const source of [signSource, finalizeSource]) {
      expect(source).toContain(".select('id,author_role,author_resident_id')");
      expect(source).toContain('isBoardPostWritableByActor');
    }
    expect(finalizeSource).toContain('isCanonicalBoardAttachmentPath');
    expect(finalizeSource).toContain(".in('storage_path', storagePaths)");
    expect(finalizeSource).toContain(".list(`board/${postId}`");
    expect(finalizeSource).toContain('actualSize !== file.fileSize');
  });

  it('updates board post fields and attachment order atomically after full validation', () => {
    const updateSource = fs.readFileSync(
      path.join(functionsRoot, 'board-update', 'index.ts'),
      'utf8',
    );
    const migrationSource = fs.readFileSync(
      path.join(repoRoot, 'supabase', 'migrations', '20260712000001_atomic_board_post_update.sql'),
      'utf8',
    );

    expect(updateSource).toContain(".rpc('update_board_post_atomic'");
    expect(updateSource).not.toMatch(/\.from\('board_posts'\)\s*\.update\(/);
    expect(updateSource).toContain('redactSensitiveText(body.title');
    expect(updateSource).toContain('redactSensitiveText(body.content');
    expect(migrationSource).toContain('create or replace function public.update_board_post_atomic');
    expect(migrationSource).toContain('with ordinality');
    expect(migrationSource).toContain('grant execute on function public.update_board_post_atomic');
  });

  it('keeps automation on a paired token and the minimal canonical digest path', () => {
    const sharedSource = fs.readFileSync(
      path.join(functionsRoot, '_shared', 'board.ts'),
      'utf8',
    );
    const createSource = fs.readFileSync(
      path.join(functionsRoot, 'board-create', 'index.ts'),
      'utf8',
    );
    const scriptSource = fs.readFileSync(
      path.join(repoRoot, 'scripts', 'ops', 'post-insurance-digest.mjs'),
      'utf8',
    );
    const blockedCliSource = fs.readFileSync(
      path.join(repoRoot, 'scripts', 'testing', 'run-remaining-blocked-cli.mjs'),
      'utf8',
    );

    expect(sharedSource).toContain("req.headers.get('x-board-automation-token')");
    expect(sharedSource).toContain("getEnv('BOARD_AUTOMATION_TOKEN')");
    expect(sharedSource).toContain('isBoardAutomationActionAllowed(action)');
    expect(createSource).toContain("actorCheck.authMode === 'automation'");
    expect(createSource).toContain("category.slug !== 'general'");
    expect(scriptSource).toContain("requireEnv(env, 'BOARD_AUTOMATION_TOKEN')");
    expect(scriptSource).toContain("'x-board-automation-token': config.automationToken");
    expect(scriptSource).not.toContain("name: 'board-category-create'");
    expect(blockedCliSource).toContain("'x-app-session-token': appSessionToken");
    expect(blockedCliSource).toContain("fn: 'login-with-password'");
    expect(blockedCliSource).not.toContain("fn: 'board-category-create'");
  });
});

import { replacePathSepForRegex } from 'jest-regex-util';
import path from 'node:path';

const config = require('../../jest.config.js');

describe('jest config source contract', () => {
  it('does not collect disposable Codex worktrees as project tests', () => {
    expect(config.testPathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
    expect(config.modulePathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
    expect(config.watchPathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
  });

  it('keeps Node and Deno suites out of Jest when a Windows worktree directory begins with a dot', () => {
    const root = path.resolve('.codex-worktrees', 'verification');
    const patterns = config.testPathIgnorePatterns.map((pattern: string) =>
      new RegExp(replacePathSepForRegex(pattern.replaceAll('<rootDir>', root))),
    );
    const ignored = (relative: string) => patterns.some((pattern: RegExp) => pattern.test(path.join(root, relative)));

    expect(ignored('web/src/lib/referral-graph-simulation.test.ts')).toBe(true);
    expect(ignored('supabase/functions/_shared/__tests__/request-board-password-sync.test.ts')).toBe(true);
    expect(ignored('lib/__tests__/board-composer-operation.test.ts')).toBe(false);
    expect(ignored('lib/__tests__/group-chat-realtime.test.ts')).toBe(false);
    expect(ignored('hooks/__tests__/use-modal-deferred-refresh.test.ts')).toBe(false);
  });
});

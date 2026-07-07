const config = require('../../jest.config.js');

describe('jest config source contract', () => {
  it('does not collect disposable Codex worktrees as project tests', () => {
    expect(config.testPathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
    expect(config.modulePathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
    expect(config.watchPathIgnorePatterns).toContain('<rootDir>/.codex-tmp/');
  });
});

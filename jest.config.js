module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageProvider: 'v8',
  modulePathIgnorePatterns: [
    '<rootDir>/.codex-tmp/',
    '<rootDir>/web/.next/',
    '<rootDir>/web/out/',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/.codex-tmp/',
    '<rootDir>/web/.next/',
    // Keep owning-runner exclusions independent of Windows worktree names:
    // Jest treats the separator before a dot directory in <rootDir> as an escape.
    '/web/src/lib/.*\\.test\\.ts$',
    '/supabase/functions/_shared/__tests__/request-board-password-sync\\.test\\.ts$',
  ],
  watchPathIgnorePatterns: [
    '<rootDir>/.codex-tmp/',
    '<rootDir>/web/.next/',
    '<rootDir>/web/out/',
  ],
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  collectCoverageFrom: [
    'lib/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'hooks/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  }
};

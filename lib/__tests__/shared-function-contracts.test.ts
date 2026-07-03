import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const auditScriptPath = join(root, 'scripts/audit/shared-function-contract-audit.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FUNCTION_AUDIT_CATEGORIES, scanSharedFunctionContracts } = require(auditScriptPath);

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('shared function contract audit', () => {
  it('tracks high-risk function categories', () => {
    const categoryIds = FUNCTION_AUDIT_CATEGORIES.map((category: { id: string }) => category.id);

    expect(categoryIds).toEqual(
      expect.arrayContaining([
        'formatters-normalizers',
        'builders-resolvers',
        'predicates-permissions',
        'mappers-converters',
        'message-display-helpers',
      ]),
    );
  });

  it('produces a live function inventory for GaramIn', () => {
    const inventory = scanSharedFunctionContracts({ root, sampleLimit: 256 });

    expect(inventory.repo).toBe('fc-onboarding-app');
    expect(inventory.excludedGlobs).toEqual(
      expect.arrayContaining(['.archive', '.codex-tmp', '_tmp', '_codex_', '_deploy_']),
    );
    expect(inventory.categories.find((category: { id: string }) => category.id === 'formatters-normalizers').hitCount)
      .toBeGreaterThan(0);
    expect(inventory.categories.find((category: { id: string }) => category.id === 'message-display-helpers').samples)
      .toEqual(expect.arrayContaining([expect.stringContaining('app\\group-chat.tsx')]));
  });

  it('documents function contracts in the handbook and governance map', () => {
    const matrix = readRepoFile('docs/handbook/feature-contract-matrix.md');
    const sharedContract = readRepoFile('docs/handbook/shared-ui-action-contracts.md');
    const contractMap = JSON.parse(readRepoFile('docs/handbook/contract-test-map.json'));

    expect(matrix).toContain('Function primitives');
    expect(sharedContract).toContain('Shared Function Contracts');
    const rule = contractMap.rules.find((item: { id: string }) => item.id === 'shared-function-primitives');
    expect(rule).toBeTruthy();
    expect(rule.prefixes).toEqual(
      expect.arrayContaining([
        'lib/exam-display.ts',
        'lib/group-chat-display.ts',
        'scripts/audit/shared-function-contract-audit.cjs',
      ]),
    );
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('request board create FC code refresh', () => {
  it('refreshes designers and FC codes when returning from code management', () => {
    const source = readRepoFile('app/request-board-create.tsx');

    expect(source).toContain('hasLoadedInitialRequestDataRef');
    expect(source).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{/);
    expect(source).toMatch(/const refreshDesignerCodeData = async \(\) => \{/);
    expect(source).toMatch(/rbGetDesigners\(\),\s*[\r\n]+\s*rbGetFcCodes\(\),/);
    expect(source).toMatch(/setDesigners\(designerRows\);\s*[\r\n]+\s*setFcCodes\(codeRows\);/);
    expect(source).toMatch(/logger\.warn\('\[request-board-create\] focus refresh failed'/);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_DIRS = ['app', 'components'];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === '__tests__') {
        return [];
      }
      return listSourceFiles(fullPath);
    }

    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe('branded loading usage contract', () => {
  it('uses the shared branded loading animation instead of raw ActivityIndicator icons', () => {
    const offenders = SOURCE_DIRS
      .flatMap((sourceDir) => listSourceFiles(join(process.cwd(), sourceDir)))
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('ActivityIndicator'))
      .map((filePath) => relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});

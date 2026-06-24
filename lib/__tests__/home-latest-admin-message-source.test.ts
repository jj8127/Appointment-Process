import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home latest admin message Sentry noise contract', () => {
  const source = readFileSync(join(process.cwd(), 'app/index.tsx'), 'utf8');

  it('does not capture optional latest-admin-message fetch failures as Sentry errors', () => {
    expect(source).not.toContain("logger.error('[Home] latest admin msg error'");
    expect(source).toContain("logger.warn('[Home] latest admin msg error'");
  });
});

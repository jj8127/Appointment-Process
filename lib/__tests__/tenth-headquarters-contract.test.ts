import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveManagerAffiliation } from '../../supabase/functions/_shared/manager-affiliation';

const root = join(__dirname, '..', '..');

describe('10본부 계약', () => {
  it('maps the manager name to the canonical headquarters label', () => {
    expect(resolveManagerAffiliation(' 한태균 ')).toBe('10본부 한태균');
  });

  it.each([
    'app/dashboard.tsx',
    'app/fc/new.tsx',
    'app/signup.tsx',
    'supabase/functions/fc-notify/index.ts',
    'web/src/app/api/admin/list/route.ts',
  ])('keeps 10본부 in %s', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(source).toContain("'10본부 한태균'");
  });

  it.each([
    'app/dashboard.tsx',
    'app/fc/new.tsx',
    'supabase/functions/fc-notify/index.ts',
    'web/src/app/api/admin/list/route.ts',
  ])('normalizes two-digit headquarters prefixes in %s', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(source).toContain('/^(10|[1-9])\\s*(본부|팀)/');
  });
});

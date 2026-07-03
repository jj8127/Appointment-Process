import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function runCanonicalSqlScript(...args: string[]) {
  return execFileSync(process.execPath, ['scripts/ops/board-category-canonical-sql.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trimEnd();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('board category contract', () => {
  it('keeps schema and repair SQL derived from the canonical category source', () => {
    const schema = readRepoFile('supabase/schema.sql');
    const migration = readRepoFile('supabase/migrations/20260608000001_update_board_categories_product_recommendation_policy.sql');
    const categoriesShared = readRepoFile('supabase/functions/_shared/board-categories.ts');
    const categoriesFunction = readRepoFile('supabase/functions/board-categories-list/index.ts');
    const canonicalSeedRows = runCanonicalSqlScript('--seed-rows').split(/\r?\n/);
    const canonicalSlugList = runCanonicalSqlScript('--slug-list');

    for (const source of [schema, migration]) {
      for (const row of canonicalSeedRows) {
        expect(source).toMatch(new RegExp(`${escapeRegExp(row)},?`));
      }
    }

    expect(migration).toContain(`where slug not in (${canonicalSlugList})`);
    expect(categoriesShared).toContain('CANONICAL_BOARD_CATEGORIES');
    expect(categoriesShared).toContain('CANONICAL_BOARD_CATEGORY_SLUGS');
    expect(categoriesFunction).toContain('CANONICAL_BOARD_CATEGORY_SLUGS');
  });

  it('moves legacy insurance news posts to general, not GaramPick', () => {
    const migration = readRepoFile('supabase/migrations/20260605000001_set_board_categories_to_four_types.sql');

    expect(migration).toMatch(/where slug = 'general'[\s\S]*category\.slug = 'insurance-news'/);
    expect(migration).not.toMatch(/where slug = 'garam-pick'[\s\S]*category\.slug = 'insurance-news'/);
  });

  it('keeps automated insurance digest posts in the general category', () => {
    const digestScript = readRepoFile('scripts/ops/post-insurance-digest.mjs');

    expect(digestScript).toContain("const CATEGORY_SLUG = 'general';");
    expect(digestScript).toContain('loadCanonicalBoardCategories');
    expect(digestScript).toContain('GENERAL_BOARD_CATEGORY.name');
    expect(digestScript).toContain('GENERAL_BOARD_CATEGORY.sortOrder');
  });

  it('validates canonical categories at board write boundaries', () => {
    for (const path of [
      'supabase/functions/board-category-create/index.ts',
      'supabase/functions/board-category-update/index.ts',
      'supabase/functions/board-create/index.ts',
      'supabase/functions/board-update/index.ts',
    ]) {
      const source = readRepoFile(path);

      expect(source).toMatch(/canonical|Canonical|isCanonical|resolveCanonical/);
    }
  });
});

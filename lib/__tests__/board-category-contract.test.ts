import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('board category contract', () => {
  it('keeps the active board category set to the five GaramIn labels', () => {
    const schema = readRepoFile('supabase/schema.sql');
    const migration = readRepoFile('supabase/migrations/20260608000001_update_board_categories_product_recommendation_policy.sql');
    const categoriesShared = readRepoFile('supabase/functions/_shared/board-categories.ts');
    const categoriesFunction = readRepoFile('supabase/functions/board-categories-list/index.ts');

    for (const source of [schema, migration]) {
      expect(source).toMatch(/'공지'\s*,\s*'notice'\s*,\s*1/);
      expect(source).toMatch(/'교육 일정'\s*,\s*'education'\s*,\s*2/);
      expect(source).toMatch(/'일반'\s*,\s*'general'\s*,\s*3/);
      expect(source).toMatch(/'상품추천'\s*,\s*'garam-pick'\s*,\s*4/);
      expect(source).toMatch(/'시책'\s*,\s*'policy'\s*,\s*5/);
      expect(source).not.toMatch(/'가람pick'\s*,\s*'garam-pick'/);
    }

    expect(categoriesShared).toContain("{ name: '공지', slug: 'notice', sortOrder: 1 }");
    expect(categoriesShared).toContain("{ name: '교육 일정', slug: 'education', sortOrder: 2 }");
    expect(categoriesShared).toContain("{ name: '일반', slug: 'general', sortOrder: 3 }");
    expect(categoriesShared).toContain("{ name: '상품추천', slug: 'garam-pick', sortOrder: 4 }");
    expect(categoriesShared).toContain("{ name: '시책', slug: 'policy', sortOrder: 5 }");
    expect(categoriesShared).not.toContain('가람pick');
    expect(categoriesFunction).toContain('CANONICAL_BOARD_CATEGORY_SLUGS');
  });

  it('moves legacy insurance news posts to general, not GaramPick', () => {
    const migration = readRepoFile('supabase/migrations/20260605000001_set_board_categories_to_four_types.sql');

    expect(migration).toMatch(/where slug = 'general'[\s\S]*category\.slug = 'insurance-news'/);
    expect(migration).not.toMatch(/where slug = 'garam-pick'[\s\S]*category\.slug = 'insurance-news'/);
  });

  it('keeps automated insurance digest posts in the general category', () => {
    const digestScript = readRepoFile('scripts/ops/post-insurance-digest.mjs');

    expect(digestScript).toContain("const CATEGORY_NAME = '일반';");
    expect(digestScript).toContain("const CATEGORY_SLUG = 'general';");
    expect(digestScript).toContain('const CATEGORY_SORT_ORDER = 3;');
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

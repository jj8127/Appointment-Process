import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildBoardCategoryDeactivateSql,
  buildBoardCategoryRepairSql,
  buildBoardCategorySeedRowsSql,
  loadCanonicalBoardCategories,
} from './board-category-canonical-sql.mjs';

const repoRoot = process.cwd();

const readRepoFile = (path) => readFileSync(join(repoRoot, path), 'utf8');

test('loads board categories from the shared canonical source only', () => {
  const categories = loadCanonicalBoardCategories({ repoRoot });

  assert.deepEqual(categories, [
    { name: '공지', slug: 'notice', sortOrder: 1 },
    { name: '교육 일정', slug: 'education', sortOrder: 2 },
    { name: '일반', slug: 'general', sortOrder: 3 },
    { name: '상품추천', slug: 'garam-pick', sortOrder: 4 },
    { name: '시책', slug: 'policy', sortOrder: 5 },
  ]);
});

test('generates canonical board category seed rows from the shared source', () => {
  const categories = loadCanonicalBoardCategories({ repoRoot });
  const rowsSql = buildBoardCategorySeedRowsSql(categories);

  assert.equal(
    rowsSql,
    [
      "  ('공지', 'notice', 1, true),",
      "  ('교육 일정', 'education', 2, true),",
      "  ('일반', 'general', 3, true),",
      "  ('상품추천', 'garam-pick', 4, true),",
      "  ('시책', 'policy', 5, true)",
    ].join('\n'),
  );
});

test('keeps schema and latest repair migration aligned with the canonical source', () => {
  const categories = loadCanonicalBoardCategories({ repoRoot });
  const rowsSql = buildBoardCategorySeedRowsSql(categories);
  const deactivateSql = buildBoardCategoryDeactivateSql(categories);
  const schema = readRepoFile('supabase/schema.sql');
  const latestMigration = readRepoFile(
    'supabase/migrations/20260703000001_reassert_board_categories_canonical.sql',
  );

  for (const row of rowsSql.split('\n')) {
    assert.match(schema, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,?$/, ',?')));
    assert.match(latestMigration, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,?$/, ',?')));
  }

  assert.match(latestMigration, new RegExp(deactivateSql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('builds an idempotent canonical repair SQL statement', () => {
  const categories = loadCanonicalBoardCategories({ repoRoot });
  const repairSql = buildBoardCategoryRepairSql(categories);

  assert.match(repairSql, /insert into public\.board_categories/);
  assert.match(repairSql, /on conflict \(slug\) do update/);
  assert.match(repairSql, /where slug not in \('notice', 'education', 'general', 'garam-pick', 'policy'\)/);
  assert.match(repairSql, /commit;/);
});

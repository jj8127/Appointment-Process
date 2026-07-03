import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CANONICAL_SOURCE = 'supabase/functions/_shared/board-categories.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultRepoRoot = resolve(__dirname, '..', '..');

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function loadCanonicalBoardCategories({
  repoRoot = defaultRepoRoot,
  canonicalSource = DEFAULT_CANONICAL_SOURCE,
} = {}) {
  const source = readFileSync(join(repoRoot, canonicalSource), 'utf8');
  const blockMatch = source.match(/CANONICAL_BOARD_CATEGORIES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!blockMatch) {
    throw new Error(`Could not find CANONICAL_BOARD_CATEGORIES in ${canonicalSource}`);
  }

  const categories = [];
  const entryPattern = /\{\s*name:\s*'([^']+)'\s*,\s*slug:\s*'([^']+)'\s*,\s*sortOrder:\s*(\d+)\s*\}/g;
  let match;
  while ((match = entryPattern.exec(blockMatch[1])) !== null) {
    categories.push({
      name: match[1],
      slug: match[2],
      sortOrder: Number.parseInt(match[3], 10),
    });
  }

  if (categories.length === 0) {
    throw new Error(`No canonical board categories parsed from ${canonicalSource}`);
  }

  const slugs = new Set();
  for (const category of categories) {
    if (!category.name || !category.slug || !Number.isInteger(category.sortOrder)) {
      throw new Error(`Invalid canonical board category: ${JSON.stringify(category)}`);
    }
    if (slugs.has(category.slug)) {
      throw new Error(`Duplicate canonical board category slug: ${category.slug}`);
    }
    slugs.add(category.slug);
  }

  return categories;
}

export function buildBoardCategorySeedRowsSql(categories) {
  return categories
    .map((category, index) => {
      const suffix = index === categories.length - 1 ? '' : ',';
      return `  (${sqlString(category.name)}, ${sqlString(category.slug)}, ${category.sortOrder}, true)${suffix}`;
    })
    .join('\n');
}

export function buildCanonicalSlugListSql(categories) {
  return categories.map((category) => sqlString(category.slug)).join(', ');
}

export function buildBoardCategoryDeactivateSql(categories) {
  return `where slug not in (${buildCanonicalSlugListSql(categories)})`;
}

export function buildBoardCategoryRepairSql(categories = loadCanonicalBoardCategories()) {
  return `begin;

insert into public.board_categories (name, slug, sort_order, is_active)
values
${buildBoardCategorySeedRowsSql(categories)}
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

with target as (
  select id
  from public.board_categories
  where slug = 'general'
  limit 1
)
update public.board_posts post
set category_id = target.id
from target, public.board_categories category
where post.category_id = category.id
  and category.slug not in (${buildCanonicalSlugListSql(categories)});

update public.board_categories
set
  is_active = false,
  updated_at = now()
${buildBoardCategoryDeactivateSql(categories)};

commit;
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const categories = loadCanonicalBoardCategories();
  const mode = process.argv[2] ?? '--repair';

  if (mode === '--seed-rows') {
    process.stdout.write(`${buildBoardCategorySeedRowsSql(categories)}\n`);
  } else if (mode === '--slug-list') {
    process.stdout.write(`${buildCanonicalSlugListSql(categories)}\n`);
  } else if (mode === '--repair') {
    process.stdout.write(buildBoardCategoryRepairSql(categories));
  } else {
    console.error('Usage: node scripts/ops/board-category-canonical-sql.mjs [--repair|--seed-rows|--slug-list]');
    process.exit(1);
  }
}

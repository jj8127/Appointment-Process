export const CANONICAL_BOARD_CATEGORIES = [
  { name: '공지', slug: 'notice', sortOrder: 1 },
  { name: '교육 일정', slug: 'education', sortOrder: 2 },
  { name: '일반', slug: 'general', sortOrder: 3 },
  { name: '가람pick', slug: 'garam-pick', sortOrder: 4 },
] as const;

export const CANONICAL_BOARD_CATEGORY_SLUGS = CANONICAL_BOARD_CATEGORIES.map((category) => category.slug);

export function findCanonicalBoardCategoryBySlug(slug?: string | null) {
  const normalized = String(slug ?? '').trim();
  return CANONICAL_BOARD_CATEGORIES.find((category) => category.slug === normalized) ?? null;
}

export function findCanonicalBoardCategoryByName(name?: string | null) {
  const normalized = String(name ?? '').trim();
  return CANONICAL_BOARD_CATEGORIES.find((category) => category.name === normalized) ?? null;
}

export function resolveCanonicalBoardCategory(input: { slug?: string | null; name?: string | null }) {
  const bySlug = input.slug === undefined ? null : findCanonicalBoardCategoryBySlug(input.slug);
  const byName = input.name === undefined ? null : findCanonicalBoardCategoryByName(input.name);

  if (input.slug !== undefined && !bySlug) return null;
  if (input.name !== undefined && !byName) return null;
  if (bySlug && byName && bySlug.slug !== byName.slug) return null;

  return bySlug ?? byName;
}

export function isCanonicalBoardCategorySlug(slug?: string | null) {
  return findCanonicalBoardCategoryBySlug(slug) !== null;
}

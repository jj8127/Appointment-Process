import {
  buildDirectMessageExcerpt,
  escapePostgrestLikeLiteral,
  normalizeDirectMessageSearchLimit,
  normalizeDirectMessageSearchQuery,
} from '../../supabase/functions/_shared/direct-message-search';

describe('Messenger V2 direct search pure boundaries', () => {
  test('counts Unicode code points rather than UTF-16 code units', () => {
    expect(normalizeDirectMessageSearchQuery('😀')).toBeNull();
    expect(normalizeDirectMessageSearchQuery('😀😀')).toBe('😀😀');
    expect(normalizeDirectMessageSearchQuery('😀'.repeat(100))).toHaveLength(200);
    expect(normalizeDirectMessageSearchQuery('😀'.repeat(101))).toBeNull();
  });

  test('keeps wildcard input literal and bounds the first page', () => {
    expect(escapePostgrestLikeLiteral(String.raw`50%_\done`))
      .toBe(String.raw`50\%\_\\done`);
    expect(normalizeDirectMessageSearchLimit(undefined)).toBe(50);
    expect(normalizeDirectMessageSearchLimit(1)).toBe(1);
    expect(normalizeDirectMessageSearchLimit(50)).toBe(50);
    expect(normalizeDirectMessageSearchLimit(51)).toBeNull();
  });

  test('collapses whitespace and caps excerpts at 240 code points', () => {
    const excerpt = buildDirectMessageExcerpt(`  ${'😀'.repeat(238)}\n   end  `);
    expect(Array.from(excerpt)).toHaveLength(240);
    expect(excerpt.endsWith('e')).toBe(true);
  });
});

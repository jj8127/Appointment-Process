import {
  mapCommissionToProfileState,
  normalizeCommissionStatus,
  type CommissionCompletionStatus,
} from '../../supabase/functions/_shared/commission';

describe('commission status mapping', () => {
  test.each([
    ['none', 'none'],
    ['life_only', 'life_only'],
    ['nonlife_only', 'nonlife_only'],
    ['both', 'both'],
    ['invalid', 'none'],
    [undefined, 'none'],
  ] as [string | undefined, CommissionCompletionStatus][])(
    'normalizeCommissionStatus(%s) -> %s',
    (input, expected) => {
      expect(normalizeCommissionStatus(input)).toBe(expected);
    },
  );

  test('none keeps draft with both pending', () => {
    expect(mapCommissionToProfileState('none')).toEqual({
      status: 'draft',
      lifeCompleted: false,
      nonlifeCompleted: false,
    });
  });

  test('life_only keeps draft with life completed only', () => {
    expect(mapCommissionToProfileState('life_only')).toEqual({
      status: 'draft',
      lifeCompleted: true,
      nonlifeCompleted: false,
    });
  });

  test('nonlife_only keeps draft with nonlife completed only', () => {
    expect(mapCommissionToProfileState('nonlife_only')).toEqual({
      status: 'draft',
      lifeCompleted: false,
      nonlifeCompleted: true,
    });
  });

  test('both moves to final-link-sent', () => {
    expect(mapCommissionToProfileState('both')).toEqual({
      status: 'final-link-sent',
      lifeCompleted: true,
      nonlifeCompleted: true,
    });
  });
});

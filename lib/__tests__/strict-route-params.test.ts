import {
  hasConflictingRouteParams,
  parseExactlyOneOnboardingSectionRouteParam,
  parseExactlyOnePositiveIntegerRouteParam,
  parseExactlyOneRouteString,
  parseExactlyOneUuidRouteParam,
} from '../strict-route-params';

const uuid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

describe('strict destination route parameters', () => {
  it('rejects every array instead of guessing a first value', () => {
    expect(parseExactlyOneRouteString(['one'])).toBeNull();
    expect(parseExactlyOneUuidRouteParam([uuid])).toBeNull();
    expect(parseExactlyOnePositiveIntegerRouteParam(['1'])).toBeNull();
  });

  it('normalizes one exact UUID and rejects whitespace or non-UUID text', () => {
    expect(parseExactlyOneUuidRouteParam(uuid)).toBe(uuid.toLowerCase());
    expect(parseExactlyOneUuidRouteParam(` ${uuid}`)).toBeNull();
    expect(parseExactlyOneUuidRouteParam('not-a-uuid')).toBeNull();
  });

  it('accepts only canonical positive safe integer text', () => {
    expect(parseExactlyOnePositiveIntegerRouteParam('42')).toBe(42);
    expect(parseExactlyOnePositiveIntegerRouteParam('01')).toBeNull();
    expect(parseExactlyOnePositiveIntegerRouteParam('1junk')).toBeNull();
    expect(parseExactlyOnePositiveIntegerRouteParam('0')).toBeNull();
    expect(
      parseExactlyOnePositiveIntegerRouteParam(
        String(Number.MAX_SAFE_INTEGER + 1),
      ),
    ).toBeNull();
  });

  it('accepts only one known onboarding section', () => {
    expect(
      parseExactlyOneOnboardingSectionRouteParam('appointment'),
    ).toBe('appointment');
    expect(
      parseExactlyOneOnboardingSectionRouteParam(['appointment']),
    ).toBeNull();
    expect(
      parseExactlyOneOnboardingSectionRouteParam('unknown'),
    ).toBeNull();
  });

  it('treats two supplied destination selectors as conflicting', () => {
    expect(hasConflictingRouteParams('one', undefined)).toBe(false);
    expect(hasConflictingRouteParams(undefined, undefined)).toBe(false);
    expect(hasConflictingRouteParams('one', 'two')).toBe(true);
    expect(hasConflictingRouteParams(['one'], 'two')).toBe(true);
  });
});

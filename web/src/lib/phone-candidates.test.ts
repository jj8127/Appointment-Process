import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPhoneCandidates } from './phone-candidates.ts';

test('keeps raw hyphenated phone first and adds digits-only without duplicates', () => {
  assert.deepStrictEqual(
    buildPhoneCandidates(' 010-1234-5678 ', '01012345678'),
    ['010-1234-5678', '01012345678'],
  );
});

test('adds standard hyphenated candidate for digits-only session values', () => {
  assert.deepStrictEqual(
    buildPhoneCandidates('01012345678', '01012345678'),
    ['01012345678', '010-1234-5678'],
  );
});

test('preserves partial raw and digits values without inventing invalid full phone formats', () => {
  assert.deepStrictEqual(
    buildPhoneCandidates(' 010-123 ', '010123'),
    ['010-123', '010123'],
  );
});

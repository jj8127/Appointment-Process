import test from 'node:test';
import assert from 'node:assert/strict';

import { formatResidentNumberBirthDateDisplay } from './resident-number-display.ts';

test('formats resident-number birth date from hyphenated and digit-only values', () => {
  assert.equal(formatResidentNumberBirthDateDisplay('900101-1234567'), '90.01.01');
  assert.equal(formatResidentNumberBirthDateDisplay('8507311234567'), '85.07.31');
});

test('keeps current empty birth-date display for nullish, short, loading, and failure values', () => {
  assert.equal(formatResidentNumberBirthDateDisplay(null), '-');
  assert.equal(formatResidentNumberBirthDateDisplay(undefined), '-');
  assert.equal(formatResidentNumberBirthDateDisplay(''), '-');
  assert.equal(formatResidentNumberBirthDateDisplay('12345'), '-');
  assert.equal(formatResidentNumberBirthDateDisplay('주민번호 조회 중...'), '-');
  assert.equal(formatResidentNumberBirthDateDisplay('주민번호 조회 실패'), '-');
});

test('ignores separators and non-digit characters before reading the first six digits', () => {
  assert.equal(formatResidentNumberBirthDateDisplay('90.01.01 / 1234567'), '90.01.01');
  assert.equal(formatResidentNumberBirthDateDisplay('생년월일 991231 주민번호 조회'), '99.12.31');
});

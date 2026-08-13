#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENTS_MAX_BYTES,
  checkAgentsFile,
  evaluateAgentsByteLength,
  evaluateAgentsContent,
} from './documentation-governance.mjs';

test('AGENTS.md accepts the exact 24,576-byte boundary', () => {
  assert.equal(AGENTS_MAX_BYTES, 24_576);
  assert.deepEqual(evaluateAgentsByteLength(24_576), {
    ok: true,
    byteLength: 24_576,
    maxBytes: 24_576,
    excessBytes: 0,
  });
});

test('AGENTS.md rejects 24,577 bytes', () => {
  assert.deepEqual(evaluateAgentsByteLength(24_577), {
    ok: false,
    byteLength: 24_577,
    maxBytes: 24_576,
    excessBytes: 1,
  });
});

test('AGENTS.md uses UTF-8 bytes rather than JavaScript character count', () => {
  const result = evaluateAgentsContent('가'.repeat(8_192));
  assert.equal(result.byteLength, 24_576);
  assert.equal(result.ok, true);

  assert.equal(evaluateAgentsContent(`${'가'.repeat(8_192)}a`).ok, false);
});

test('the repository AGENTS.md satisfies the size gate', () => {
  const result = checkAgentsFile('AGENTS.md');
  assert.equal(result.ok, true, result.error ?? 'AGENTS.md should pass');
});

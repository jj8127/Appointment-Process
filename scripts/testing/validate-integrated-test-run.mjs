#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const casesPath = path.join(root, 'docs', 'testing', 'integrated-test-cases.json');
const inArg = process.argv.find((arg) => arg.startsWith('--in='));
const inPath = inArg
  ? path.resolve(root, inArg.slice('--in='.length))
  : path.join(root, 'docs', 'testing', 'INTEGRATED_TEST_RUN_RESULT.json');

const ALLOWED_STATUS = new Set(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED']);

function fail(message) {
  console.error(`[integrated-test:validate] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(casesPath)) fail(`case file not found: ${casesPath}`);
if (!fs.existsSync(inPath)) {
  fail(`run result not found: ${inPath}\nrun: npm run qa:init:integrated`);
}

const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const result = JSON.parse(fs.readFileSync(inPath, 'utf8'));

if (!Array.isArray(cases) || !cases.length) fail('case file is empty');
if (!result || !Array.isArray(result.runs)) fail('run result format invalid: "runs" array required');

const caseIds = new Set(cases.map((c) => c.id));
const seen = new Set();
const errors = [];
const counters = { NOT_RUN: 0, PASS: 0, FAIL: 0, BLOCKED: 0, SKIPPED: 0 };

for (const row of result.runs) {
  const id = row.caseId;
  if (!id || typeof id !== 'string') {
    errors.push('row with missing caseId');
    continue;
  }
  if (seen.has(id)) errors.push(`${id}: duplicate row`);
  seen.add(id);
  if (!caseIds.has(id)) errors.push(`${id}: unknown caseId`);

  const status = row.status;
  if (!ALLOWED_STATUS.has(status)) {
    errors.push(`${id}: invalid status "${status}"`);
    continue;
  }
  counters[status] += 1;

  if (status !== 'NOT_RUN') {
    if (!row.executedAt || typeof row.executedAt !== 'string') {
      errors.push(`${id}: executedAt required when status is ${status}`);
    }
  }

  if (status === 'PASS') {
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
      errors.push(`${id}: evidence required when status is PASS`);
    }
  }

  if (status === 'FAIL' || status === 'BLOCKED' || status === 'SKIPPED') {
    if (!row.notes || typeof row.notes !== 'string' || row.notes.trim() === '') {
      errors.push(`${id}: notes required when status is ${status}`);
    }
  }
}

for (const expectedId of caseIds) {
  if (!seen.has(expectedId)) errors.push(`${expectedId}: missing row`);
}

if (errors.length > 0) {
  console.error('[integrated-test:validate] validation failed');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

if (counters.NOT_RUN > 0) {
  fail(`not executed cases remain: ${counters.NOT_RUN}`);
}

console.log('[integrated-test:validate] OK');
console.log(
  `[integrated-test:validate] PASS=${counters.PASS}, FAIL=${counters.FAIL}, BLOCKED=${counters.BLOCKED}, SKIPPED=${counters.SKIPPED}`,
);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const casesPath = path.join(root, 'docs', 'testing', 'integrated-test-cases.json');
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const force = process.argv.includes('--force');
const outPath = outArg
  ? path.resolve(root, outArg.slice('--out='.length))
  : path.join(root, 'docs', 'testing', 'INTEGRATED_TEST_RUN_RESULT.json');

if (!fs.existsSync(casesPath)) {
  console.error(`[integrated-test:init] case file not found: ${casesPath}`);
  process.exit(1);
}

if (fs.existsSync(outPath) && !force) {
  console.error(`[integrated-test:init] output exists: ${outPath}`);
  console.error('use --force to overwrite');
  process.exit(1);
}

const raw = fs.readFileSync(casesPath, 'utf8');
const cases = JSON.parse(raw);
if (!Array.isArray(cases) || cases.length === 0) {
  console.error('[integrated-test:init] case file is empty');
  process.exit(1);
}

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'docs/testing/integrated-test-cases.json',
    note: 'status: NOT_RUN | PASS | FAIL | BLOCKED | SKIPPED',
  },
  runs: cases.map((tc) => ({
    caseId: tc.id,
    area: tc.area,
    priority: tc.priority,
    platform: tc.platform,
    title: tc.title,
    status: 'NOT_RUN',
    owner: '',
    executedAt: '',
    evidence: [],
    notes: '',
  })),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[integrated-test:init] wrote ${payload.runs.length} cases -> ${outPath}`);

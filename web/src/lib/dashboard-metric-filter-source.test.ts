import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync('web/src/app/dashboard/page.tsx', 'utf8');
const cssSource = readFileSync('web/src/app/dashboard/page.module.css', 'utf8');

test('dashboard metric cards filter the FC list and expose selected state', () => {
  assert.match(pageSource, /useState<'all' \| 'pendingAllowance' \| 'pendingDocs'>\('all'\)/);
  assert.match(pageSource, /metricFilter === 'pendingAllowance'/);
  assert.match(pageSource, /fc\.step === 1 && \['entered', 'prescreen'\]\.includes\(allowanceDisplay\.key\)/);
  assert.match(pageSource, /metricFilter === 'pendingDocs'/);
  assert.match(pageSource, /fc\.step === 2 && getDocProgress\(fc\)\.key === 'in-progress'/);
  assert.match(pageSource, /aria-pressed=\{metricFilter === 'pendingAllowance'\}/);
  assert.match(pageSource, /aria-pressed=\{metricFilter === 'pendingDocs'\}/);
});

test('metric cards toggle to all and workflow tabs clear card filtering', () => {
  assert.match(pageSource, /current === nextFilter && nextFilter !== 'all' \? 'all' : nextFilter/);
  assert.match(pageSource, /const handleActiveTabChange[\s\S]+setMetricFilter\('all'\)/);
  assert.match(pageSource, /onChange=\{handleActiveTabChange\}/);
  assert.match(cssSource, /\.metricCard\[data-tone='allowance'\]\[data-active\]/);
  assert.match(cssSource, /\.metricCard\[data-tone='documents'\]\[data-active\]/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync('web/src/app/dashboard/page.tsx', 'utf8');
const cssSource = readFileSync('web/src/app/dashboard/page.module.css', 'utf8');

// Queue conditions themselves are covered by dashboard-work-queue.test.ts.
test('home queue cards filter the FC list through the shared work-queue rule and expose selected state', () => {
  assert.match(pageSource, /useState<DashboardMetricFilter>\('all'\)/);
  assert.match(pageSource, /getFcWorkQueueKey\(fc\) === metricFilter/);
  assert.match(
    pageSource,
    /getDashboardWorkQueueKey\(\{\s*step: calcStep\(fc\),\s*allowanceKey: getAllowanceDisplayState\(fc\)\.key,\s*docProgressKey: getDocProgress\(fc\)\.key,\s*hanwhaKey: getHanwhaProgress\(fc\)\.key,/,
  );
  assert.match(pageSource, /aria-pressed=\{metricFilter === queue\.key\}/);
  assert.match(pageSource, /onClick=\{\(\) => handleMetricFilterChange\(queue\.key\)\}/);
});

test('queue cards toggle back to all and workflow tabs clear card filtering', () => {
  assert.match(pageSource, /current === nextFilter && nextFilter !== 'all' \? 'all' : nextFilter/);
  assert.match(pageSource, /const handleActiveTabChange[\s\S]+setMetricFilter\('all'\)/);
  assert.match(pageSource, /onChange=\{handleActiveTabChange\}/);
  assert.match(cssSource, /\.metricCard\[data-active\]/);
});

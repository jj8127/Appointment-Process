#!/usr/bin/env node
import fs from 'node:fs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log('[pr-template-check] skip: no GITHUB_EVENT_PATH');
    return;
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    console.log('[pr-template-check] skip: not a pull_request event');
    return;
  }

  const body = String(pr.body ?? '');

  const requiredChecks = [
    'PROJECT_GUIDE.md 확인',
    'WORK_DETAIL 앵커 추가/업데이트',
    'WORK_LOG 최근 작업 1행 추가/검토',
    '스키마 변경 시 schema.sql + migrations 동시 반영',
    '릴리즈/운영 영향(함수 배포·마이그레이션) 기재',
  ];

  const missing = [];
  for (const label of requiredChecks) {
    const checked = new RegExp(`-\\s*\\[[xX]\\]\\s*${escapeRegExp(label)}\\s*$`, 'm').test(body);
    if (!checked) missing.push(label);
  }

  if (missing.length > 0) {
    console.error('[pr-template-check] failed');
    for (const label of missing) {
      console.error(`- Missing checked item: ${label}`);
    }
    process.exit(1);
  }

  console.log('[pr-template-check] passed');
}

main();

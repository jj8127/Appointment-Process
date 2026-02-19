#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fileExists(path) {
  return fs.existsSync(path);
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function listChangedFiles() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;

  try {
    if (base && head) {
      const out = run(`git diff --name-only --diff-filter=ACMR ${base} ${head}`);
      return out ? out.split(/\r?\n/).filter(Boolean) : [];
    }
    const out = run('git diff --name-only --diff-filter=ACMR HEAD~1 HEAD');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    const out = run('git diff --name-only --diff-filter=ACMR');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  }
}

function extractAnchorsFromWorkLog(content) {
  const anchorRegex = /\[→ 상세\]\(WORK_DETAIL\.md#([^)]+)\)/g;
  const anchors = [];
  for (const match of content.matchAll(anchorRegex)) {
    anchors.push(match[1]);
  }
  return anchors;
}

function hasAnchorInWorkDetail(content, anchor) {
  return new RegExp(`<a id="${anchor}"><\\/a>`, 'm').test(content);
}

function isCodePath(path) {
  return (
    path.startsWith('app/') ||
    path.startsWith('web/') ||
    path.startsWith('supabase/') ||
    path.startsWith('components/') ||
    path.startsWith('hooks/') ||
    path.startsWith('lib/') ||
    path.startsWith('types/')
  );
}

function main() {
  const errors = [];

  const requiredDocs = ['.claude/PROJECT_GUIDE.md', '.claude/WORK_LOG.md', '.claude/WORK_DETAIL.md'];
  for (const file of requiredDocs) {
    if (!fileExists(file)) errors.push(`Missing required doc file: ${file}`);
  }

  if (errors.length === 0) {
    const workLog = read('.claude/WORK_LOG.md');
    const workDetail = read('.claude/WORK_DETAIL.md');
    const anchors = extractAnchorsFromWorkLog(workLog);

    if (anchors.length === 0) {
      errors.push('WORK_LOG.md does not contain any WORK_DETAIL anchor links.');
    }

    for (const anchor of anchors) {
      if (!hasAnchorInWorkDetail(workDetail, anchor)) {
        errors.push(`WORK_LOG anchor not found in WORK_DETAIL: ${anchor}`);
      }
    }
  }

  const changed = listChangedFiles();
  if (changed.length > 0) {
    const codeChanged = changed.some(isCodePath);
    const workLogChanged = changed.includes('.claude/WORK_LOG.md');
    const workDetailChanged = changed.includes('.claude/WORK_DETAIL.md');
    if (codeChanged && (!workLogChanged || !workDetailChanged)) {
      errors.push('Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.');
    }

    const schemaChanged = changed.includes('supabase/schema.sql');
    const migrationChanged = changed.some((file) => file.startsWith('supabase/migrations/') && file.endsWith('.sql'));
    if (schemaChanged !== migrationChanged) {
      errors.push('Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.');
    }
  }

  if (errors.length > 0) {
    console.error('[governance-check] failed');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log('[governance-check] passed');
}

main();

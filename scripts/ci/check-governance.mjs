#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

import { checkAgentsFile } from './documentation-governance.mjs';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fileExists(path) {
  return fs.existsSync(path);
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

function handbookSyncRequired() {
  return process.argv.includes('--require-handbook-sync') || process.env.REQUIRE_HANDBOOK_SYNC === '1';
}

function contractSyncRequired() {
  return (
    process.argv.includes('--require-contract-sync') ||
    process.env.REQUIRE_CONTRACT_SYNC === '1' ||
    process.env.REQUIRE_FEATURE_CONTRACT_SYNC === '1'
  );
}

function hasDirtyWorktree() {
  try {
    return Boolean(run('git status --short'));
  } catch {
    return false;
  }
}

function listUntrackedFiles() {
  try {
    const out = run('git ls-files --others --exclude-standard');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mergeChangedFiles(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function listChangedFiles() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;

  try {
    if (base && head) {
      const out = run(`git diff --name-only --diff-filter=ACMR ${base} ${head}`);
      return out ? out.split(/\r?\n/).filter(Boolean) : [];
    }
    if (hasDirtyWorktree()) {
      const out = run('git diff --name-only --diff-filter=ACMR');
      const tracked = out ? out.split(/\r?\n/).filter(Boolean) : [];
      return mergeChangedFiles(tracked, listUntrackedFiles());
    }
    const out = run('git diff --name-only --diff-filter=ACMR HEAD~1 HEAD');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    const out = run('git diff --name-only --diff-filter=ACMR');
    const tracked = out ? out.split(/\r?\n/).filter(Boolean) : [];
    return mergeChangedFiles(tracked, listUntrackedFiles());
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

function isHandbookSensitivePath(path) {
  return (
    path.startsWith('app/') ||
    path.startsWith('web/src/app/') ||
    path.startsWith('web/src/hooks/') ||
    path.startsWith('web/src/lib/') ||
    path.startsWith('components/') ||
    path.startsWith('hooks/') ||
    path.startsWith('lib/') ||
    path.startsWith('types/') ||
    path.startsWith('supabase/functions/') ||
    path.startsWith('supabase/migrations/') ||
    path === 'supabase/schema.sql'
  );
}

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function getMatchingPrefixLength(path, rule) {
  let best = -1;
  for (const prefix of rule.prefixes) {
    if (path === prefix || path.startsWith(prefix)) {
      best = Math.max(best, prefix.length);
    }
  }
  return best;
}

function collectTriggeredRules(changedFiles, rules, errors) {
  const triggered = new Map();
  for (const file of changedFiles) {
    const scored = rules
      .map((rule) => ({ rule, score: getMatchingPrefixLength(file, rule) }))
      .filter((entry) => entry.score >= 0);

    if (scored.length === 0) {
      errors.push(`No path-owner-map rule for handbook-sensitive path: ${file}`);
      continue;
    }

    const bestScore = Math.max(...scored.map((entry) => entry.score));
    for (const entry of scored.filter((item) => item.score === bestScore)) {
      const current = triggered.get(entry.rule.id) ?? { rule: entry.rule, files: [] };
      current.files.push(file);
      triggered.set(entry.rule.id, current);
    }
  }
  return triggered;
}

function collectTriggeredContractRules(changedFiles, rules) {
  const triggered = new Map();
  for (const file of changedFiles) {
    const scored = rules
      .map((rule) => ({ rule, score: getMatchingPrefixLength(file, rule) }))
      .filter((entry) => entry.score >= 0);

    if (scored.length === 0) continue;

    const bestScore = Math.max(...scored.map((entry) => entry.score));
    for (const entry of scored.filter((item) => item.score === bestScore)) {
      const current = triggered.get(entry.rule.id) ?? { rule: entry.rule, files: [] };
      current.files.push(file);
      triggered.set(entry.rule.id, current);
    }
  }
  return triggered;
}

function isContractMapEnforced(contractMap, requireContractSync) {
  return requireContractSync || contractMap.default_enforced === true;
}

function isDocumentedSeverity(rule) {
  return rule.severity === 'behavior' || rule.severity === 'contract';
}

function main() {
  const errors = [];
  const requireHandbookSync = handbookSyncRequired();
  const requireContractSync = contractSyncRequired();

  const agentsSize = checkAgentsFile('AGENTS.md');
  if (!agentsSize.ok) errors.push(agentsSize.error);

  const requiredDocs = [
    '.claude/PROJECT_GUIDE.md',
    '.claude/MISTAKES.md',
    '.claude/WORK_LOG.md',
    '.claude/WORK_DETAIL.md',
    'docs/handbook/feature-contract-matrix.md',
    'docs/handbook/contract-test-map.json',
    'docs/handbook/path-owner-map.json',
  ];
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
  const normalizedChanged = changed.map(normalizePath);
  if (changed.length > 0) {
    const codeChanged = normalizedChanged.some(isCodePath);
    const handbookSensitiveChanged = normalizedChanged.some(isHandbookSensitivePath);
    const handbookSensitiveFiles = normalizedChanged.filter(isHandbookSensitivePath);
    const workLogChanged = normalizedChanged.includes('.claude/WORK_LOG.md');
    const workDetailChanged = normalizedChanged.includes('.claude/WORK_DETAIL.md');
    const handbookChanged = normalizedChanged.some((file) => file.startsWith('docs/handbook/'));
    if (codeChanged && (!workLogChanged || !workDetailChanged)) {
      errors.push('Code changed but WORK_LOG.md and WORK_DETAIL.md were not both updated.');
    }
    if (handbookSensitiveChanged && !handbookChanged) {
      if (requireHandbookSync) {
        errors.push('Handbook sync mode is enabled but docs/handbook/* was not updated.');
      }
    }

    if (handbookSensitiveFiles.length > 0) {
      const ownerMap = readJson('docs/handbook/path-owner-map.json');
      const enforceOwnerDocs = requireHandbookSync || (handbookChanged && handbookSensitiveChanged);
      const ownerErrors = [];
      const triggered = collectTriggeredRules(handbookSensitiveFiles, ownerMap.rules ?? [], ownerErrors);
      if (enforceOwnerDocs) {
        for (const ownerError of ownerErrors) errors.push(ownerError);
        for (const { rule, files } of triggered.values()) {
          if (!isDocumentedSeverity(rule)) continue;
          const satisfied = rule.requires_any.some((path) => normalizedChanged.includes(path));
          if (!satisfied) {
            errors.push(
              `Path-owner-map violation for ${files.join(', ')}: update one of ${rule.requires_any.join(', ')}`
            );
          }
        }
      }
    }

    if (fileExists('docs/handbook/contract-test-map.json')) {
      const contractMap = readJson('docs/handbook/contract-test-map.json');
      const enforceContractDocs = isContractMapEnforced(contractMap, requireContractSync);
      const contractTriggered = collectTriggeredContractRules(normalizedChanged, contractMap.rules ?? []);
      if (enforceContractDocs) {
        for (const { rule, files } of contractTriggered.values()) {
          const requiredEvidence = rule.requires_any ?? [];
          const satisfied = requiredEvidence.some((path) => normalizedChanged.includes(path));
          if (!satisfied) {
            errors.push(
              `Feature contract violation for ${files.join(', ')}: update one of ${requiredEvidence.join(', ')}`
            );
          }
        }
      }
    }

    const schemaChanged = normalizedChanged.includes('supabase/schema.sql');
    const migrationChanged = normalizedChanged.some(
      (file) => file.startsWith('supabase/migrations/') && file.endsWith('.sql')
    );
    if (schemaChanged !== migrationChanged) {
      errors.push('Schema change policy violation: update supabase/schema.sql and supabase/migrations/*.sql together.');
    }
  }

  if (errors.length > 0) {
    console.error('[governance-check] failed');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  if (requireHandbookSync) {
    console.log('[governance-check] handbook sync mode enabled');
  }
  if (requireContractSync) {
    console.log('[governance-check] contract sync mode enabled');
  }
  console.log('[governance-check] passed');
}

main();

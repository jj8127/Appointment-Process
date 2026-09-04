#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DEFAULT_ORG = 'hanhwa-lifelab';
const DEFAULT_PROJECTS = ['react-native', 'garamin-web'];
const DEFAULT_ENVIRONMENT = 'production';
const DEFAULT_STATS_PERIOD = '24h';
const DEFAULT_LIMIT = 25;
const DEFAULT_EVENT_LIMIT = 3;
const DEFAULT_MAX_PAGES = 100;
const SENTRY_API_BASE_URL = 'https://sentry.io';
const execFileAsync = promisify(execFile);

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    dryRun: false,
    projects: [],
    summaryOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      return argv[index];
    };

    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--summary-only') {
      parsed.summaryOnly = true;
    } else if (arg === '--daily-report') {
      parsed.dailyReport = true;
    } else if (arg === '--all-time') {
      parsed.allTime = true;
    } else if (arg === '--all-environments') {
      parsed.allEnvironments = true;
    } else if (arg === '--org') {
      parsed.org = next().trim();
    } else if (arg === '--project') {
      parsed.projects.push(next().trim());
    } else if (arg === '--limit') {
      parsed.limit = parsePositiveInteger(next(), '--limit');
    } else if (arg === '--event-limit') {
      parsed.eventLimit = parsePositiveInteger(next(), '--event-limit');
    } else if (arg === '--max-pages') {
      parsed.maxPages = parsePositiveInteger(next(), '--max-pages');
    } else if (arg === '--start') {
      parsed.start = next().trim();
    } else if (arg === '--end') {
      parsed.end = next().trim();
    } else if (arg === '--stats-period') {
      parsed.statsPeriod = next().trim();
    } else if (arg === '--last-seen-days') {
      parsed.lastSeenDays = parsePositiveInteger(next(), '--last-seen-days');
    } else if (arg === '--environment') {
      parsed.environment = next().trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.projects = parsed.projects.filter(Boolean);
  return parsed;
}

function parseEnvFile(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\\r/g, '').replace(/\\n/g, '').trim();
  }
  return env;
}

async function readEnvFile(path) {
  try {
    return parseEnvFile(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function readGitValue(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function resolveRuntimeEnvDirs(cwd = process.cwd()) {
  const currentDir = resolve(cwd);
  const dirs = [];
  const commonGitDir = await readGitValue(currentDir, ['rev-parse', '--git-common-dir']);

  if (commonGitDir) {
    const resolvedCommonGitDir = resolve(currentDir, commonGitDir);
    const primaryCheckout = dirname(resolvedCommonGitDir);
    dirs.push(primaryCheckout);
  }

  dirs.push(currentDir);
  return Array.from(new Set(dirs));
}

export async function loadRuntimeEnv({ cwd = process.cwd(), baseEnv = process.env } = {}) {
  const fileEnv = {};
  const envDirs = await resolveRuntimeEnvDirs(cwd);
  for (const dir of envDirs) {
    Object.assign(
      fileEnv,
      await readEnvFile(join(dir, '.env')),
      await readEnvFile(join(dir, '.env.local')),
    );
  }

  return {
    ...fileEnv,
    ...baseEnv,
  };
}

function getKstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  };
}

function formatKstYmd(date = new Date()) {
  const { year, month, day } = getKstDateParts(date);
  return `${year}${month}${day}`;
}

function formatUtcYmd(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgoYmd(days, now) {
  const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return formatUtcYmd(date);
}

function resolveConfig({ args = {}, env = process.env, now = new Date() } = {}) {
  const envProjects = splitCsv(env.SENTRY_PROJECTS);
  const lastSeenDays = args.lastSeenDays ?? null;
  const lastSeenSince = lastSeenDays ? daysAgoYmd(lastSeenDays, now) : null;
  const bounded = args.start !== undefined || args.end !== undefined;
  if (bounded && (!Number.isFinite(Date.parse(args.start)) || !Number.isFinite(Date.parse(args.end)) || Date.parse(args.start) >= Date.parse(args.end))) {
    throw new Error('Explicit start/end must be valid ISO timestamps in ascending order.');
  }
  if ((args.allTime && (bounded || lastSeenDays || args.statsPeriod)) || (bounded && (lastSeenDays || args.statsPeriod))) {
    throw new Error('All-time, relative, last-seen, and explicit time ranges cannot be combined.');
  }
  if (args.dailyReport && (bounded || lastSeenDays || args.allTime || args.allEnvironments || args.statsPeriod !== undefined)) {
    throw new Error('--daily-report owns its recent and backlog scopes; do not override their time or environment coverage.');
  }
  if ((args.limit ?? DEFAULT_LIMIT) > 100) throw new Error('Issue page limit must not exceed 100.');

  return {
    org: String(args.org || env.SENTRY_ORG || DEFAULT_ORG).trim(),
    projects: (args.projects?.length ? args.projects : envProjects.length ? envProjects : DEFAULT_PROJECTS)
      .map((project) => String(project).trim())
      .filter(Boolean),
    environment: args.allEnvironments ? '' : String(args.environment ?? env.SENTRY_ENVIRONMENT ?? DEFAULT_ENVIRONMENT).trim(),
    statsPeriod: args.allTime || bounded ? '' : String(args.statsPeriod ?? (lastSeenDays ? '14d' : DEFAULT_STATS_PERIOD)).trim(),
    start: bounded ? new Date(args.start).toISOString() : null,
    end: bounded ? new Date(args.end).toISOString() : null,
    maxPages: args.maxPages ?? DEFAULT_MAX_PAGES,
    limit: args.limit ?? DEFAULT_LIMIT,
    eventLimit: args.eventLimit ?? DEFAULT_EVENT_LIMIT,
    lastSeenDays,
    lastSeenSince,
    summaryOnly: Boolean(args.summaryOnly),
    dailyReport: Boolean(args.dailyReport),
  };
}

function requireReadToken(env) {
  const readToken = String(env.SENTRY_READ_AUTH_TOKEN ?? '').trim();
  if (!readToken) {
    throw new Error('Missing required environment variable: SENTRY_READ_AUTH_TOKEN. SENTRY_AUTH_TOKEN is upload-only and must not be used for Sentry API reads.');
  }
  return readToken;
}

function issueQuery(config) {
  return [config.includeResolved ? '' : 'is:unresolved', 'level:[fatal,error]', config.lastSeenSince ? `lastSeen:>=${config.lastSeenSince}` : '', config.start ? `lastSeen:>=${config.start}` : '', config.end ? `lastSeen:<=${config.end}` : '']
    .filter(Boolean)
    .join(' ');
}

function buildIssuesUrl(config) {
  const url = new URL(`/api/0/organizations/${config.org}/issues/`, SENTRY_API_BASE_URL);
  if (config.environment) url.searchParams.set('environment', config.environment);
  url.searchParams.set('statsPeriod', config.statsPeriod);
  if (config.start) url.searchParams.set('start', config.start);
  if (config.end) url.searchParams.set('end', config.end);
  url.searchParams.set('query', issueQuery(config));
  url.searchParams.set('sort', 'freq');
  url.searchParams.set('limit', String(config.limit));
  for (const project of config.projects) {
    url.searchParams.append('project', project);
  }
  return url;
}

function buildIssueDetailUrl(issueId, config) {
  const url = new URL(`/api/0/organizations/${config.org}/issues/${issueId}/`, SENTRY_API_BASE_URL);
  if (config.environment) url.searchParams.set('environment', config.environment);
  return url;
}

function buildIssueEventsUrl(issueId, config) {
  const url = new URL(`/api/0/organizations/${config.org}/issues/${issueId}/events/`, SENTRY_API_BASE_URL);
  if (config.environment) url.searchParams.set('environment', config.environment);
  url.searchParams.set('statsPeriod', config.statsPeriod);
  if (config.start) url.searchParams.set('start', config.start);
  if (config.end) url.searchParams.set('end', config.end);
  url.searchParams.set('full', '1');
  url.searchParams.set('limit', String(config.eventLimit));
  return url;
}

async function fetchJson({ fetchImpl, url, readToken, withHeaders = false }) {
  let response;
  try {
    response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${readToken}`,
    },
    });
  } catch {
    throw new Error('SENTRY_NETWORK_ERROR');
  }
  // Never include the remote error body: it may contain private event data.
  if (!response.ok) throw new Error(`SENTRY_HTTP_${Number(response.status) || 'ERROR'}`);
  let payload = null;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error('SENTRY_INVALID_JSON');
  }
  return withHeaders ? { payload, link: response.headers?.get?.('link') ?? null } : payload;
}

function nextIssuePage(link) {
  const next = String(link ?? '').split(',').find((part) => /rel="next"/.test(part));
  if (!next) return { complete: false, reason: 'PAGINATION_UNVERIFIED' };
  if (/results="false"/.test(next)) return { complete: true, cursor: null };
  if (!/results="true"/.test(next)) return { complete: false, reason: 'PAGINATION_UNVERIFIED' };
  const cursorAttribute = next.match(/cursor="([^"]+)"/)?.[1];
  try {
    const cursor = cursorAttribute ?? new URL(next.match(/<([^>]+)>/)?.[1]).searchParams.get('cursor');
    return cursor ? { complete: false, cursor } : { complete: false, reason: 'PAGINATION_UNVERIFIED' };
  } catch {
    return { complete: false, reason: 'PAGINATION_UNVERIFIED' };
  }
}

async function collectIssuePages({ config, fetchImpl, readToken }) {
  const issues = new Map();
  const pages = [];
  const cursors = new Set();
  let cursor = null;
  let reason = 'PAGE_LIMIT_REACHED';
  let excludedOutOfWindow = 0;
  for (let page = 0; page < config.maxPages; page += 1) {
    const url = buildIssuesUrl(config);
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    try {
      response = await fetchJson({ fetchImpl, readToken, url, withHeaders: true });
    } catch (error) {
      reason = error.message;
      break;
    }
    if (!Array.isArray(response.payload) || response.payload.some((issue) => !issue || !/^\d+$/.test(String(issue.id ?? '')))) {
      reason = 'SENTRY_INVALID_ISSUE_LIST';
      break;
    }
    if (config.projects.length === 1 && response.payload.some((issue) => issue.project?.slug !== config.projects[0])) {
      reason = 'SENTRY_PROJECT_MISMATCH';
      break;
    }
    if (config.start && response.payload.some((issue) => !Number.isFinite(Date.parse(issue.lastSeen ?? issue.last_seen ?? '')))) {
      reason = 'SENTRY_MISSING_LAST_SEEN';
      break;
    }
    const previousCount = issues.size;
    for (const issue of response.payload) {
      const seenAt = lastSeenTime(issue);
      if (config.start && (seenAt < Date.parse(config.start) || seenAt > Date.parse(config.end))) {
        excludedOutOfWindow += 1;
        continue;
      }
      issues.set(String(issue.id), issue);
    }
    const next = nextIssuePage(response.link);
    pages.push({ count: issues.size - previousCount, hasNext: !next.complete, cursorPresent: Boolean(next.cursor) });
    if (next.complete) return { status: 'COMPLETE', issues: [...issues.values()], pages, exhausted: true, excludedOutOfWindow, reason: null };
    if (!next.cursor || cursors.has(next.cursor)) {
      reason = next.reason ?? 'PAGINATION_CURSOR_REPEATED';
      break;
    }
    cursors.add(next.cursor);
    cursor = next.cursor;
  }
  return { status: pages.length ? 'PARTIAL' : 'BLOCKED', issues: [...issues.values()], pages, exhausted: false, excludedOutOfWindow, reason };
}

function kstTimestamp(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

async function dailyReport({ config, fetchImpl, env, at, dryRun }) {
  const start = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  const projects = [...new Set(config.projects)].sort();
  const plan = {
    version: 1,
    window: { startUtc: start.toISOString(), endUtc: at.toISOString(), startKst: kstTimestamp(start), endKst: kstTimestamp(at) },
    projects,
    environment: config.environment,
    queries: projects.flatMap((project) => [
      { project, scope: 'recent_24h', parameters: { query: `level:[fatal,error] lastSeen:>=${start.toISOString()} lastSeen:<=${at.toISOString()}`, environment: config.environment, start: start.toISOString(), end: at.toISOString(), statsPeriod: '' } },
      { project, scope: 'unresolved_backlog', parameters: { query: 'is:unresolved level:[fatal,error]', statsPeriod: '' } },
    ]),
  };
  const readToken = String(env.SENTRY_READ_AUTH_TOKEN ?? '').trim();
  if (dryRun) return { status: 'dry-run', plan, hasReadToken: Boolean(readToken), usesUploadTokenFallback: false };
  const queries = [];
  for (const planned of plan.queries) {
    const scopedConfig = { ...config, projects: [planned.project], environment: planned.parameters.environment ?? '', statsPeriod: '', start: planned.parameters.start ?? null, end: planned.parameters.end ?? null, includeResolved: planned.scope === 'recent_24h' };
    const collected = readToken
      ? await collectIssuePages({ config: scopedConfig, fetchImpl, readToken })
      : { status: 'BLOCKED', issues: [], pages: [], exhausted: false, reason: 'READ_TOKEN_MISSING' };
    queries.push({ ...planned, status: collected.status, count: collected.status === 'COMPLETE' ? collected.issues.length : null, observedCount: collected.issues.length, excludedOutOfWindow: collected.excludedOutOfWindow ?? 0, pages: collected.pages, exhausted: collected.exhausted, reason: collected.reason, issues: collected.issues.map(summarizeIssue) });
  }
  const complete = queries.filter((query) => query.status === 'COMPLETE').length;
  const status = complete === queries.length ? 'COMPLETE' : queries.some((query) => query.status !== 'BLOCKED') ? 'PARTIAL' : 'BLOCKED';
  const countScope = (scope) => queries.filter((query) => query.scope === scope).every((query) => query.status === 'COMPLETE')
    ? queries.filter((query) => query.scope === scope).reduce((sum, query) => sum + query.count, 0) : null;
  return { status, plan, queries, recentIssueCount: countScope('recent_24h'), unresolvedBacklogCount: countScope('unresolved_backlog'), serviceResolution: 'NOT_VERIFIED', usesUploadTokenFallback: false };
}

function numeric(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function levelRank(issue) {
  const level = String(issue?.level ?? issue?.metadata?.level ?? '').toLowerCase();
  if (level === 'fatal') return 0;
  if (level === 'error') return 1;
  return 2;
}

function lastSeenTime(issue) {
  const value = Date.parse(issue?.lastSeen ?? issue?.last_seen ?? issue?.dateCreated ?? '');
  return Number.isFinite(value) ? value : 0;
}

function isFatalOrError(issue) {
  const level = String(issue?.level ?? issue?.metadata?.level ?? '').toLowerCase();
  return !level || level === 'fatal' || level === 'error';
}

export function selectCandidateIssue(issues = []) {
  const candidates = issues.filter((issue) => issue?.id && isFatalOrError(issue));
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => {
    const rankDiff = levelRank(left) - levelRank(right);
    if (rankDiff !== 0) return rankDiff;

    const userDiff = numeric(right.userCount ?? right.user_count) - numeric(left.userCount ?? left.user_count);
    if (userDiff !== 0) return userDiff;

    const countDiff = numeric(right.count) - numeric(left.count);
    if (countDiff !== 0) return countDiff;

    return lastSeenTime(right) - lastSeenTime(left);
  })[0];
}

function issueShortId(issue) {
  return String(issue?.shortId ?? issue?.short_id ?? issue?.culprit ?? issue?.id ?? 'sentry-issue').trim();
}

function issueTitle(issue) {
  return String(issue?.title ?? issue?.metadata?.title ?? issue?.metadata?.type ?? 'Sentry production issue').trim();
}

function branchSafe(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sentry-issue';
}

function truncate(value, maxLength) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function issueLink(issue) {
  return String(issue?.permalink ?? issue?.url ?? '').trim();
}

function summarizeIssue(issue) {
  const safeIdentifier = (value, pattern) => pattern.test(String(value ?? '')) ? String(value) : null;
  const lastSeen = Date.parse(issue?.lastSeen ?? issue?.last_seen ?? '');
  const level = String(issue?.level ?? issue?.metadata?.level ?? '').toLowerCase();
  let permalink = null;
  try {
    const parsed = new URL(issueLink(issue));
    if (parsed.protocol === 'https:' && /(^|\.)sentry\.io$/.test(parsed.hostname) && /^\/issues\/\d+\/?$/.test(parsed.pathname)) permalink = `${parsed.origin}${parsed.pathname}`;
  } catch { /* Missing links do not justify copying other event data. */ }
  return {
    id: issue?.id ?? null,
    shortId: safeIdentifier(issue?.shortId ?? issue?.short_id, /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/),
    level: ['fatal', 'error', 'warning', 'info', 'debug'].includes(level) ? level : null,
    lifetimeEventCount: Math.max(0, numeric(issue?.lifetime?.count ?? issue?.count)),
    userCount: Math.max(0, numeric(issue?.userCount ?? issue?.user_count)),
    lastSeen: Number.isFinite(lastSeen) ? new Date(lastSeen).toISOString() : null,
    project: safeIdentifier(issue?.project?.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    permalink,
  };
}

export function buildDraftPrMetadata({ issue, latestEvent = null, now = new Date() }) {
  const shortId = issueShortId(issue);
  const title = issueTitle(issue);
  const date = formatKstYmd(now);
  const branch = `codex/sentry-daily-${date}-${branchSafe(shortId)}`;
  const project = issue?.project?.slug ?? issue?.project?.name ?? 'unknown-project';
  const link = issueLink(issue) || `Sentry issue ${shortId}`;
  const latestEventLine = latestEvent?.id
    ? `- Latest event: ${latestEvent.id}${latestEvent.dateCreated ? ` at ${latestEvent.dateCreated}` : ''}`
    : '- Latest event: not returned by Sentry API';

  const body = [
    '## Sentry evidence',
    `- Sentry issue: ${link}`,
    `- Project: ${project}`,
    `- Short id: ${shortId}`,
    latestEventLine,
    '',
    '## Automation scope',
    '- This draft PR should contain one focused fix for this Sentry issue or a tightly related cause group.',
    '- Sentry issue status was not changed.',
    '- Production deploys, EAS Update, native builds, and Sentry resolve are out of scope for this automation.',
    '',
    '## Required verification before ready-for-review',
    '- Run the smallest targeted regression test for the changed code.',
    '- Run `npm run lint` and `npx tsc --noEmit --pretty false`.',
    "- For mobile/shared changes, run `SENTRY_AUTH_TOKEN='' npm run build`.",
    "- For admin web changes, run `cd web && SENTRY_AUTH_TOKEN='' npm run build`.",
  ].join('\n');

  return {
    branch,
    title: `fix(sentry): ${shortId} ${truncate(title, 72)}`,
    body,
  };
}

export function createSentryDailyTriageRunner({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  return async function runSentryDailyTriage({ env = process.env, args = {}, dryRun = args.dryRun ?? false } = {}) {
    const at = now();
    const config = resolveConfig({ args, env, now: at });
    const hasReadToken = Boolean(String(env.SENTRY_READ_AUTH_TOKEN ?? '').trim());
    if (config.dailyReport) return dailyReport({ config, fetchImpl, env, at, dryRun });

    if (dryRun) {
      return {
        status: 'dry-run',
        org: config.org,
        projects: config.projects,
        environment: config.environment,
        statsPeriod: config.statsPeriod,
        start: config.start,
        end: config.end,
        query: issueQuery(config),
        limit: config.limit,
        eventLimit: config.eventLimit,
        lastSeenDays: config.lastSeenDays,
        summaryOnly: config.summaryOnly,
        hasReadToken,
        usesUploadTokenFallback: false,
      };
    }

    const readToken = requireReadToken(env);
    const collected = await collectIssuePages({ config, fetchImpl, readToken });
    const issueList = collected.issues;
    const coverage = {
      queryStatus: collected.status,
      pages: collected.pages,
      exhausted: collected.exhausted,
      reason: collected.reason,
      excludedOutOfWindow: collected.excludedOutOfWindow,
      start: config.start,
      end: config.end,
      serviceResolution: 'NOT_VERIFIED',
    };
    if (collected.status !== 'COMPLETE') {
      return { status: collected.status, org: config.org, projects: config.projects, environment: config.environment, statsPeriod: config.statsPeriod, query: issueQuery(config), issueCount: null, observedIssueCount: issueList.length, issues: issueList.map(summarizeIssue), ...coverage };
    }

    if (config.summaryOnly) {
      return {
        status: 'summary',
        org: config.org,
        projects: config.projects,
        environment: config.environment,
        statsPeriod: config.statsPeriod,
        query: issueQuery(config),
        issueCount: issueList.length,
        issues: issueList.map(summarizeIssue),
        ...coverage,
      };
    }

    const issue = selectCandidateIssue(issueList);

    if (!issue) {
      return {
        status: 'no-issues',
        org: config.org,
        projects: config.projects,
        environment: config.environment,
        statsPeriod: config.statsPeriod,
        query: issueQuery(config),
        ...coverage,
      };
    }

    const [detail, events] = await Promise.all([
      fetchJson({ fetchImpl, readToken, url: buildIssueDetailUrl(issue.id, config) }),
      fetchJson({ fetchImpl, readToken, url: buildIssueEventsUrl(issue.id, config) }),
    ]);
    const eventList = Array.isArray(events) ? events : [];
    const latestEvent = eventList[0] ?? null;
    const detailedIssue = { ...issue, ...(detail && typeof detail === 'object' ? detail : {}) };

    return {
      status: 'issue-found',
      org: config.org,
      projects: config.projects,
      environment: config.environment,
      statsPeriod: config.statsPeriod,
      query: issueQuery(config),
      ...coverage,
      issue: detailedIssue,
      latestEvent,
      events: eventList.slice(0, config.eventLimit),
      draftPr: buildDraftPrMetadata({
        issue: detailedIssue,
        latestEvent,
        now: now(),
      }),
    };
  };
}

async function main() {
  const args = parseArgs();
  const env = await loadRuntimeEnv();
  const runner = createSentryDailyTriageRunner();
  const result = await runner({
    env,
    args,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'BLOCKED' || result.status === 'PARTIAL') process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORY_NAME = '일반';
const CATEGORY_SLUG = 'general';
const CATEGORY_SORT_ORDER = 3;
const TITLE_PREFIX = '보험소식 브리핑';

export function getKstDateParts(date = new Date()) {
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

export function buildDigestTitle(date = new Date()) {
  const { year, month, day } = getKstDateParts(date);
  return `${TITLE_PREFIX} ${year}.${month}.${day}`;
}

function uniqueUrls(sourceUrls = []) {
  return Array.from(
    new Set(
      sourceUrls
        .map((url) => String(url ?? '').trim())
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  );
}

function buildSourceLabel(url, fallbackLabel) {
  const label = String(fallbackLabel ?? '').trim().replace(/\s+/g, ' ');
  if (label && !/^https?:\/\//i.test(label)) {
    return label.slice(0, 80);
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || '출처 확인';
  } catch {
    return '출처 확인';
  }
}

export function formatDigestContent({ content, sourceUrls = [], sourceLabels = [] }) {
  const trimmed = String(content ?? '').trim();
  const urls = uniqueUrls(sourceUrls);
  const labels = Array.isArray(sourceLabels) ? sourceLabels : [];
  const hasVisibleSources = /(^|\n)\s*(?:[-*]\s*)?출처\s*:/m.test(trimmed);
  const sourceBlock = urls.length > 0 && !hasVisibleSources
    ? [
        '',
        '출처',
        ...urls.map((url, index) => `${index + 1}. ${buildSourceLabel(url, labels[index])}`),
      ].join('\n')
    : '';
  return `${trimmed}${sourceBlock}`.trim();
}

function parseJsonInput(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('JSON payload must be an object.');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
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

function firstCsvValue(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.replace(/[^0-9]/g, ''))
    .find((item) => item.length === 11) ?? '';
}

function deriveRuntimeEnv(env) {
  const derived = { ...env };
  derived.SUPABASE_URL ||= derived.NEXT_PUBLIC_SUPABASE_URL || derived.EXPO_PUBLIC_SUPABASE_URL;
  derived.SUPABASE_ANON_KEY ||= derived.NEXT_PUBLIC_SUPABASE_ANON_KEY || derived.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  derived.BOARD_AUTOMATION_ACTOR_ROLE ||= 'admin';
  derived.BOARD_AUTOMATION_ACTOR_PHONE ||= firstCsvValue(
    derived.NEXT_PUBLIC_ADMIN_PHONES || derived.EXPO_PUBLIC_ADMIN_PHONES,
  );
  derived.BOARD_AUTOMATION_ACTOR_NAME ||= '보험소식 브리핑';
  return derived;
}

export async function loadRuntimeEnv({ cwd = process.cwd(), baseEnv = process.env } = {}) {
  const fileEnv = {
    ...(await readEnvFile(join(cwd, '.env'))),
    ...(await readEnvFile(join(cwd, '.env.local'))),
  };
  return deriveRuntimeEnv({
    ...fileEnv,
    ...baseEnv,
  });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    dryRun: false,
    checkExisting: false,
    digest: {},
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
    } else if (arg === '--check-existing') {
      parsed.checkExisting = true;
    } else if (arg === '--input-json') {
      parsed.digest = {
        ...parsed.digest,
        ...parseJsonInput(next(), '--input-json'),
      };
    } else if (arg === '--input-file') {
      parsed.inputFile = next();
    } else if (arg === '--title') {
      parsed.digest.title = next();
    } else if (arg === '--content') {
      parsed.digest.content = next();
    } else if (arg === '--source-url') {
      parsed.digest.sourceUrls = [...(parsed.digest.sourceUrls ?? []), next()];
    } else if (arg === '--source-label') {
      parsed.digest.sourceLabels = [...(parsed.digest.sourceLabels ?? []), next()];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function readDigestFromCli(parsed) {
  if (!parsed.inputFile) return parsed.digest;
  const raw = await readFile(parsed.inputFile, 'utf8');
  return {
    ...parsed.digest,
    ...parseJsonInput(raw, parsed.inputFile),
  };
}

function requireEnv(env, name) {
  const value = String(env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function containsSecretAssignment(value) {
  return /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=/i
    .test(String(value ?? ''));
}

function getSupabaseConfig(env) {
  return {
    url: requireEnv(env, 'SUPABASE_URL').replace(/\/+$/, ''),
    anonKey: requireEnv(env, 'SUPABASE_ANON_KEY'),
  };
}

function buildActor(env) {
  const role = String(env.BOARD_AUTOMATION_ACTOR_ROLE ?? 'admin').trim();
  const residentId = String(env.BOARD_AUTOMATION_ACTOR_PHONE ?? '').replace(/[^0-9]/g, '');
  const displayName = String(env.BOARD_AUTOMATION_ACTOR_NAME ?? '보험소식 브리핑').trim();

  if (!['admin', 'manager'].includes(role)) {
    throw new Error('BOARD_AUTOMATION_ACTOR_ROLE must be admin or manager.');
  }
  if (residentId.length !== 11) {
    throw new Error('BOARD_AUTOMATION_ACTOR_PHONE must be 11 digits.');
  }
  if (containsSecretAssignment(displayName)) {
    throw new Error('BOARD_AUTOMATION_ACTOR_NAME must not contain secrets.');
  }

  return { role, residentId, displayName };
}

function normalizeDigest(digest, date = new Date()) {
  const title = String(digest.title ?? buildDigestTitle(date)).trim();
  const content = String(digest.content ?? '').trim();
  const sourceUrls = uniqueUrls(Array.isArray(digest.sourceUrls) ? digest.sourceUrls : []);
  const sourceLabels = Array.isArray(digest.sourceLabels) ? digest.sourceLabels : [];

  if (!title) {
    throw new Error('Digest title is required.');
  }
  if (!title.startsWith(TITLE_PREFIX)) {
    throw new Error(`Digest title must start with "${TITLE_PREFIX}".`);
  }
  if (!content) {
    throw new Error('Digest content is required.');
  }
  if (sourceUrls.length === 0) {
    throw new Error('At least one source URL is required.');
  }

  return {
    title,
    content: formatDigestContent({ content, sourceUrls, sourceLabels }),
    sourceUrls,
    sourceLabels,
    categoryName: CATEGORY_NAME,
    categorySlug: CATEGORY_SLUG,
  };
}

async function invokeFunction({ fetchImpl, config, name, body }) {
  const response = await fetchImpl(`${config.url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.anonKey}`,
      apikey: config.anonKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message = payload?.message ?? raw ?? `${name} failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload?.data;
}

export function createInsuranceDigestStatusRunner({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  return async function checkInsuranceDigestStatus({ env = process.env, digest = {} } = {}) {
    const title = String(digest.title ?? buildDigestTitle(now())).trim();
    if (!title) {
      throw new Error('Digest title is required.');
    }
    if (!title.startsWith(TITLE_PREFIX)) {
      throw new Error(`Digest title must start with "${TITLE_PREFIX}".`);
    }

    const actor = buildActor(env);
    const config = getSupabaseConfig(env);
    const categories = await invokeFunction({
      fetchImpl,
      config,
      name: 'board-categories-list',
      body: { actor },
    });

    const categoryId = categories?.find?.((category) => category.slug === CATEGORY_SLUG)?.id;
    if (!categoryId) {
      return {
        status: 'missing',
        reason: 'general category not found',
        title,
      };
    }

    const list = await invokeFunction({
      fetchImpl,
      config,
      name: 'board-list',
      body: {
        actor,
        categoryId,
        sort: 'created',
        order: 'desc',
        limit: 50,
      },
    });

    const existingPost = list?.items?.find?.((item) => item.title === title);
    if (existingPost?.id) {
      return {
        status: 'exists',
        categoryId,
        existingPostId: existingPost.id,
        title,
      };
    }

    return {
      status: 'missing',
      categoryId,
      title,
    };
  };
}

export function createPostInsuranceDigestRunner({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  return async function postInsuranceDigest({ env = process.env, digest, dryRun = false }) {
    const normalizedDigest = normalizeDigest(digest ?? {}, now());
    const actor = buildActor(env);
    const payload = {
      ...normalizedDigest,
      actor,
    };

    if (dryRun) {
      return {
        status: 'dry-run',
        payload,
      };
    }

    const config = getSupabaseConfig(env);
    const categories = await invokeFunction({
      fetchImpl,
      config,
      name: 'board-categories-list',
      body: { actor },
    });

    let categoryId = categories?.find?.((category) => category.slug === CATEGORY_SLUG)?.id;

    if (!categoryId) {
      const created = await invokeFunction({
        fetchImpl,
        config,
        name: 'board-category-create',
        body: {
          actor,
          name: CATEGORY_NAME,
          slug: CATEGORY_SLUG,
          sortOrder: CATEGORY_SORT_ORDER,
          isActive: true,
        },
      });
      categoryId = created?.id;
    }

    if (!categoryId) {
      throw new Error('Unable to resolve general board category.');
    }

    const list = await invokeFunction({
      fetchImpl,
      config,
      name: 'board-list',
      body: {
        actor,
        categoryId,
        sort: 'created',
        order: 'desc',
        limit: 50,
      },
    });

    const existingPost = list?.items?.find?.((item) => item.title === normalizedDigest.title);
    if (existingPost?.id) {
      return {
        status: 'skipped',
        categoryId,
        existingPostId: existingPost.id,
        title: normalizedDigest.title,
      };
    }

    const created = await invokeFunction({
      fetchImpl,
      config,
      name: 'board-create',
      body: {
        actor,
        categoryId,
        title: normalizedDigest.title,
        content: normalizedDigest.content,
      },
    });

    return {
      status: 'posted',
      categoryId,
      postId: created?.id,
      title: normalizedDigest.title,
    };
  };
}

async function main() {
  const parsed = parseArgs();
  const digest = await readDigestFromCli(parsed);
  const env = await loadRuntimeEnv();
  if (parsed.checkExisting) {
    const runner = createInsuranceDigestStatusRunner();
    const result = await runner({ env, digest });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'exists') {
      process.exitCode = 2;
    }
    return;
  }

  const runner = createPostInsuranceDigestRunner();
  const result = await runner({
    env,
    digest,
    dryRun: parsed.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

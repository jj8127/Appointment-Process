import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function normalizeName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
    limit: Number.POSITIVE_INFINITY,
    reason: '',
    issueReason: '',
  };

  for (const arg of args) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      continue;
    }

    if (arg.startsWith('--reason=')) {
      options.reason = arg.slice('--reason='.length).trim();
      continue;
    }

    if (arg.startsWith('--issue-reason=')) {
      options.issueReason = arg.slice('--issue-reason='.length).trim();
      continue;
    }
  }

  if (!options.reason) {
    options.reason = `legacy_auto_resolve_exact_unique_${options.date}`;
  }

  if (!options.issueReason) {
    options.issueReason = `legacy_support_issue_for_exact_unique_${options.date}`;
  }

  return options;
}

function isEligibleProfile(profile, excludedAdminPhones) {
  const phone = normalizeDigits(profile.phone);
  const affiliation = String(profile.affiliation ?? '');
  const name = String(profile.name ?? '');

  return phone.length === 11
    && !affiliation.includes('설계매니저')
    && !/QA|테스트|TEST/i.test(affiliation)
    && !/QA|테스트|TEST/i.test(name)
    && !excludedAdminPhones.has(phone)
    && (profile.signup_completed === true || profile.is_manager_referral_shadow === true);
}

function buildActiveCodeByFc(codeRows) {
  const activeCodeByFc = new Map();

  for (const row of codeRows) {
    if (!activeCodeByFc.has(row.fc_id)) {
      activeCodeByFc.set(row.fc_id, row);
    }
  }

  return activeCodeByFc;
}

function buildExactProfileMatches(profiles) {
  const byName = new Map();

  for (const profile of profiles) {
    const key = normalizeName(profile.name);
    if (!key) {
      continue;
    }

    const current = byName.get(key) ?? [];
    current.push(profile);
    byName.set(key, current);
  }

  return byName;
}

function classifyLegacyItems(profiles, activeCodeByFc) {
  const exactProfilesByName = buildExactProfileMatches(profiles);
  const unresolved = profiles
    .filter((profile) => normalizeName(profile.recommender) && !profile.recommender_fc_id)
    .map((profile) => {
      const legacyRecommenderName = normalizeName(profile.recommender);
      const exactProfiles = (exactProfilesByName.get(legacyRecommenderName) ?? [])
        .filter((candidate) => candidate.id !== profile.id)
        .map((candidate) => ({
          fcId: candidate.id,
          name: normalizeName(candidate.name),
          phone: normalizeDigits(candidate.phone),
          affiliation: normalizeName(candidate.affiliation),
          activeCode: activeCodeByFc.get(candidate.id)?.code ?? null,
          isManagerShadow: candidate.is_manager_referral_shadow === true,
          signupCompleted: candidate.signup_completed === true,
        }));
      const activeCandidates = exactProfiles.filter((candidate) => candidate.activeCode);

      let resolutionStage = 'blocked';
      let blockReason = 'missing_candidate';
      let selectedCandidate = null;

      if (normalizeName(profile.name) === legacyRecommenderName) {
        blockReason = 'self_referral';
      } else if (activeCandidates.length === 1) {
        resolutionStage = 'ready';
        blockReason = null;
        selectedCandidate = activeCandidates[0];
      } else if (exactProfiles.length === 1) {
        resolutionStage = 'needs_code';
        blockReason = null;
        selectedCandidate = exactProfiles[0];
      } else if (activeCandidates.length > 1 || exactProfiles.length > 1) {
        blockReason = 'ambiguous';
      }

      return {
        inviteeFcId: profile.id,
        inviteeName: normalizeName(profile.name),
        inviteePhone: normalizeDigits(profile.phone),
        inviteeAffiliation: normalizeName(profile.affiliation),
        legacyRecommenderName,
        selectedCandidate,
        exactProfiles,
        activeCandidates,
        resolutionStage,
        blockReason,
      };
    });

  return unresolved;
}

function summarizeBy(items, keySelector) {
  return items.reduce((accumulator, item) => {
    const key = keySelector(item);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

async function rpcSingle(supabase, fn, params) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    throw new Error(`${fn}: ${error.message}`);
  }

  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

async function fetchBaseDataset(supabase) {
  const [fcRes, adminRes, codeRes] = await Promise.all([
    supabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,recommender,recommender_fc_id,signup_completed,is_manager_referral_shadow')
      .order('created_at', { ascending: false }),
    supabase.from('admin_accounts').select('phone'),
    supabase
      .from('referral_codes')
      .select('id,fc_id,code,is_active,created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ]);

  if (fcRes.error) {
    throw fcRes.error;
  }
  if (adminRes.error) {
    throw adminRes.error;
  }
  if (codeRes.error) {
    throw codeRes.error;
  }

  const excludedAdminPhones = new Set(
    (adminRes.data ?? [])
      .map((row) => normalizeDigits(row.phone))
      .filter((phone) => phone.length === 11),
  );

  const eligibleProfiles = (fcRes.data ?? []).filter((profile) => isEligibleProfile(profile, excludedAdminPhones));
  const activeCodeByFc = buildActiveCodeByFc(codeRes.data ?? []);

  return {
    eligibleProfiles,
    activeCodeByFc,
  };
}

function toInviteeLine(item) {
  return `- ${item.inviteeName} | ${item.inviteePhone} | ${item.inviteeAffiliation} | legacy=${item.legacyRecommenderName}`;
}

async function main() {
  const options = parseArgs();
  const env = loadEnv(path.join(process.cwd(), '.env.local'));
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const initialDataset = await fetchBaseDataset(supabase);
  let unresolved = classifyLegacyItems(initialDataset.eligibleProfiles, initialDataset.activeCodeByFc);
  const initiallyReady = unresolved.filter((item) => item.resolutionStage === 'ready');
  const needsCode = unresolved.filter((item) => item.resolutionStage === 'needs_code');

  const issuedCodes = [];
  const issueFailures = [];

  if (options.apply) {
    const uniqueInvitersNeedingCodes = Array.from(new Map(
      needsCode.map((item) => [item.selectedCandidate.fcId, item.selectedCandidate]),
    ).values()).slice(0, options.limit);

    for (const inviter of uniqueInvitersNeedingCodes) {
      try {
        const result = await rpcSingle(supabase, 'admin_issue_referral_code', {
          p_fc_id: inviter.fcId,
          p_actor_phone: null,
          p_actor_role: 'admin',
          p_actor_staff_type: 'developer',
          p_reason: options.issueReason,
          p_rotate: false,
        });

        issuedCodes.push({
          inviterFcId: inviter.fcId,
          inviterName: inviter.name,
          phone: inviter.phone,
          affiliation: inviter.affiliation,
          result,
        });
      } catch (error) {
        issueFailures.push({
          inviterFcId: inviter.fcId,
          inviterName: inviter.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const refreshedDataset = await fetchBaseDataset(supabase);
    unresolved = classifyLegacyItems(refreshedDataset.eligibleProfiles, refreshedDataset.activeCodeByFc);
  }

  const readyAfterIssue = unresolved.filter((item) => item.resolutionStage === 'ready').slice(0, options.limit);
  const blocked = unresolved.filter((item) => item.resolutionStage === 'blocked');

  const applied = [];
  const applyFailures = [];

  if (options.apply) {
    for (const item of readyAfterIssue) {
      try {
        const result = await rpcSingle(supabase, 'admin_apply_recommender_override', {
          p_invitee_fc_id: item.inviteeFcId,
          p_inviter_fc_id: item.selectedCandidate.fcId,
          p_actor_phone: null,
          p_actor_role: 'admin',
          p_actor_staff_type: 'developer',
          p_reason: options.reason,
        });

        applied.push({
          inviteeFcId: item.inviteeFcId,
          inviteeName: item.inviteeName,
          inviteePhone: item.inviteePhone,
          inviteeAffiliation: item.inviteeAffiliation,
          legacyRecommenderName: item.legacyRecommenderName,
          inviterFcId: item.selectedCandidate.fcId,
          inviterName: item.selectedCandidate.name,
          inviterPhone: item.selectedCandidate.phone,
          inviterAffiliation: item.selectedCandidate.affiliation,
          referralCode: item.selectedCandidate.activeCode,
          result,
        });
      } catch (error) {
        applyFailures.push({
          inviteeFcId: item.inviteeFcId,
          inviteeName: item.inviteeName,
          legacyRecommenderName: item.legacyRecommenderName,
          inviterFcId: item.selectedCandidate.fcId,
          inviterName: item.selectedCandidate.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const verifyInviteeIds = applied.map((item) => item.inviteeFcId);
  const verification = {
    fcProfiles: [],
    latestEvents: [],
  };

  if (options.apply && verifyInviteeIds.length > 0) {
    const [profileRes, eventRes] = await Promise.all([
      supabase
        .from('fc_profiles')
        .select('id,name,phone,affiliation,recommender,recommender_fc_id')
        .in('id', verifyInviteeIds)
        .order('name', { ascending: true }),
      supabase
        .from('referral_events')
        .select('invitee_fc_id,inviter_fc_id,referral_code,event_type,source,metadata,created_at')
        .in('invitee_fc_id', verifyInviteeIds)
        .eq('event_type', 'admin_override_applied')
        .order('created_at', { ascending: false }),
    ]);

    if (profileRes.error) {
      throw profileRes.error;
    }
    if (eventRes.error) {
      throw eventRes.error;
    }

    verification.fcProfiles = profileRes.data ?? [];
    verification.latestEvents = eventRes.data ?? [];
  }

  const reportsDir = path.join(process.cwd(), '.codex', 'harness', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const baseName = `legacy-recommender-reconcile-${options.date}`;
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);

  const payload = {
    executedAt: new Date().toISOString(),
    apply: options.apply,
    reason: options.reason,
    issueReason: options.issueReason,
    initialSummary: summarizeBy(classifyLegacyItems(initialDataset.eligibleProfiles, initialDataset.activeCodeByFc), (item) => item.resolutionStage === 'blocked' ? item.blockReason : item.resolutionStage),
    afterIssueSummary: summarizeBy(unresolved, (item) => item.resolutionStage === 'blocked' ? item.blockReason : item.resolutionStage),
    initiallyReadyCount: initiallyReady.length,
    needsCodeCount: needsCode.length,
    issuedCodes,
    issueFailures,
    applied,
    applyFailures,
    blocked,
    verification,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const markdown = [
    '# 레거시 추천인 정리 보고서',
    '',
    `- 실행일: ${options.date}`,
    `- 적용 모드: ${options.apply ? 'apply' : 'dry-run'}`,
    `- override reason: ${options.reason}`,
    `- issue reason: ${options.issueReason}`,
    '',
    '## 초기 분류',
    ...Object.entries(payload.initialSummary).map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## 코드 발급 후 분류',
    ...Object.entries(payload.afterIssueSummary).map(([key, count]) => `- ${key}: ${count}`),
    '',
    `## 코드 발급 처리 (${issuedCodes.length})`,
    ...(issuedCodes.length > 0
      ? issuedCodes.map((item) => `- ${item.inviterName} | ${item.phone} | ${item.affiliation} | code=${item.result?.code ?? '-'} | changed=${String(item.result?.changed ?? false)}`)
      : ['- 없음']),
    '',
    `## 추천인 연결 적용 (${applied.length})`,
    ...(applied.length > 0
      ? applied.map((item) => `- ${item.inviteeName}(${item.inviteePhone}) -> ${item.inviterName}(${item.referralCode ?? '-'}) | ${item.inviteeAffiliation}`)
      : ['- 없음']),
    '',
    `## 적용 실패 (${applyFailures.length})`,
    ...(applyFailures.length > 0
      ? applyFailures.map((item) => `- ${item.inviteeName} -> ${item.inviterName}: ${item.message}`)
      : ['- 없음']),
    '',
    `## 차단된 항목 (${blocked.length})`,
    ...(blocked.length > 0
      ? blocked.map((item) => `${toInviteeLine(item)} | status=${item.blockReason}`)
      : ['- 없음']),
  ].join('\n');

  fs.writeFileSync(mdPath, markdown, 'utf8');

  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    initiallyReadyCount: initiallyReady.length,
    needsCodeCount: needsCode.length,
    appliedCount: applied.length,
    blockedCount: blocked.length,
    issueFailures: issueFailures.length,
    applyFailures: applyFailures.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

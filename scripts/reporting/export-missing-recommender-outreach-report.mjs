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
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function toExcelTextFormula(value) {
  return `="${String(value ?? '')}"`;
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    date: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
    }).format(new Date()),
    suffix: '',
    excludeManagerNames: false,
    excludeNames: new Set(),
  };

  for (const arg of args) {
    if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length);
      continue;
    }

    if (arg === '--exclude-manager-names') {
      options.excludeManagerNames = true;
      continue;
    }

    if (arg.startsWith('--exclude-names=')) {
      for (const name of arg.slice('--exclude-names='.length).split(',')) {
        const normalized = normalizeText(name);
        if (normalized) {
          options.excludeNames.add(normalized);
        }
      }
      continue;
    }

    if (arg.startsWith('--suffix=')) {
      options.suffix = arg.slice('--suffix='.length).trim();
    }
  }

  return options;
}

function isTestAccount(row) {
  return /QA|테스트|TEST/i.test(String(row.affiliation ?? '')) || /QA|테스트|TEST/i.test(String(row.name ?? ''));
}

function isOperationalFc(row, adminPhones, managerPhones) {
  const phone = normalizeDigits(row.phone);
  const name = normalizeText(row.name);
  const affiliation = String(row.affiliation ?? '');

  return phone.length === 11
    && name.length > 0
    && !affiliation.includes('설계매니저')
    && !adminPhones.has(phone)
    && !managerPhones.has(phone)
    && !isTestAccount(row);
}

function toStatusLabel(value, outreachRequired) {
  if (!outreachRequired) return '발송대상아님';
  if (value === '전송 완료') return '전송완료';
  if (value === '기존 메시지 있음') return '기존메시지있음';
  if (value === '발송 실패') return '발송실패';
  if (value === '미리보기') return '미리보기';
  return '미전송';
}

async function main() {
  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, '.env.local');
  const env = loadEnv(envPath);

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const options = parseArgs();
  const reportDate = options.date;

  const reconciliationPath = path.join(repoRoot, '.codex', 'harness', 'reports', `legacy-recommender-reconcile-${reportDate}.json`);
  const messageReportPath = path.join(repoRoot, '.codex', 'harness', 'reports', `missing-recommender-message-send-${reportDate}.json`);

  const reconciliation = fs.existsSync(reconciliationPath)
    ? JSON.parse(fs.readFileSync(reconciliationPath, 'utf8'))
    : { blocked: [] };
  const messageReport = fs.existsSync(messageReportPath)
    ? JSON.parse(fs.readFileSync(messageReportPath, 'utf8'))
    : { items: [], sender: null };

  const blockedByPhone = new Map(
    (Array.isArray(reconciliation.blocked) ? reconciliation.blocked : []).map((item) => [
      normalizeDigits(item.inviteePhone),
      item,
    ]),
  );
  const sentByPhone = new Map(
    (Array.isArray(messageReport.items) ? messageReport.items : []).map((item) => [
      normalizeDigits(item.inviteePhone),
      item,
    ]),
  );

  const [{ data: profileRows, error: profileError }, { data: adminRows, error: adminError }, { data: managerRows, error: managerError }] = await Promise.all([
    supabase
      .from('fc_profiles')
      .select('phone, name, affiliation, recommender')
      .eq('signup_completed', true)
      .is('recommender_fc_id', null)
      .order('affiliation', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true }),
    supabase.from('admin_accounts').select('phone'),
    supabase.from('manager_accounts').select('phone,name'),
  ]);

  if (profileError) {
    throw profileError;
  }

  if (adminError) {
    throw adminError;
  }

  if (managerError) {
    throw managerError;
  }

  const adminPhones = new Set((adminRows ?? []).map((row) => normalizeDigits(row.phone)));
  const managerPhones = new Set((managerRows ?? []).map((row) => normalizeDigits(row.phone)));
  const managerNames = new Set((managerRows ?? []).map((row) => normalizeText(row.name)).filter(Boolean));

  const rows = (profileRows ?? [])
    .filter((row) => isOperationalFc(row, adminPhones, managerPhones))
    .filter((row) => {
      const normalizedName = normalizeText(row.name);
      if (options.excludeNames.has(normalizedName)) {
        return false;
      }

      if (options.excludeManagerNames && managerNames.has(normalizedName)) {
        return false;
      }

      return true;
    })
    .map((row) => {
      const phone = normalizeDigits(row.phone);
      const blocked = blockedByPhone.get(phone) ?? null;
      const sent = sentByPhone.get(phone) ?? null;
      const outreachRequired = Boolean(blocked);
      const messageStatus = toStatusLabel(sent?.status, outreachRequired);

      return {
        phone,
        name: normalizeText(row.name),
        affiliation: normalizeText(row.affiliation),
        legacyRecommenderDisplay: normalizeText(row.recommender),
        outreachRequired: outreachRequired ? '예' : '아니오',
        blockedReason: normalizeText(blocked?.blockReason),
        messageStatus,
        messageSentAt: sent?.createdAt ?? sent?.existingCreatedAt ?? '',
        messageSenderPhone: normalizeDigits(messageReport.sender?.phone),
      };
    });

  const reportsDir = path.join(repoRoot, '.codex', 'harness', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const suffixSegment = options.suffix ? `-${options.suffix}` : '';
  const baseName = `fc-missing-recommender-${reportDate}-outreach${suffixSegment}`;
  const excelCsvPath = path.join(reportsDir, `${baseName}.csv`);
  const rawCsvPath = path.join(reportsDir, `${baseName}.raw.csv`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);
  const appliedExemptions = [
    ...(options.excludeManagerNames ? ['본부장 이름 예외'] : []),
    ...Array.from(options.excludeNames).map((name) => `${name} 예외`),
  ];

  const headers = [
    'phone',
    'name',
    'affiliation',
    'legacy_recommender_display',
    'outreach_required',
    'blocked_reason',
    'message_status',
    'message_sent_at',
    'message_sender_phone',
  ];

  const excelCsv = [
    headers.join(','),
    ...rows.map((row) => [
      toExcelTextFormula(row.phone),
      row.name,
      row.affiliation,
      row.legacyRecommenderDisplay,
      row.outreachRequired,
      row.blockedReason,
      row.messageStatus,
      row.messageSentAt,
      toExcelTextFormula(row.messageSenderPhone),
    ].map(csvEscape).join(',')),
  ].join('\n');

  const rawCsv = [
    headers.join(','),
    ...rows.map((row) => [
      row.phone,
      row.name,
      row.affiliation,
      row.legacyRecommenderDisplay,
      row.outreachRequired,
      row.blockedReason,
      row.messageStatus,
      row.messageSentAt,
      row.messageSenderPhone,
    ].map(csvEscape).join(',')),
  ].join('\n');

  const outreachTargetCount = rows.filter((row) => row.outreachRequired === '예').length;
  const sentCount = rows.filter((row) => row.messageStatus === '전송완료').length;
  const skippedCount = rows.filter((row) => row.messageStatus === '기존메시지있음').length;

  const md = [
    '# 추천인 미등록 FC 목록 + 안내 메시지 상태',
    '',
    `- 조회일: ${reportDate}`,
    '- 기준: `signup_completed = true`, `recommender_fc_id IS NULL`, 유효한 11자리 전화번호, 관리자/매니저/설계매니저 제외, QA/테스트 계정 제외',
    ...(appliedExemptions.length > 0 ? [`- 추가 예외: ${appliedExemptions.join(', ')}`] : []),
    `- 전체 건수: ${rows.length}`,
    `- 메시지 발송 대상: ${outreachTargetCount}`,
    `- 신규 전송 완료: ${sentCount}`,
    `- 기존 동일 메시지로 건너뜀: ${skippedCount}`,
    '',
    '| 전화번호 | 이름 | 소속 | 레거시 추천인 | 발송 대상 | 차단 사유 | 메시지 상태 | 발송 시각 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.phone} | ${row.name} | ${row.affiliation} | ${row.legacyRecommenderDisplay} | ${row.outreachRequired} | ${row.blockedReason} | ${row.messageStatus} | ${row.messageSentAt} |`),
  ].join('\n');

  fs.writeFileSync(excelCsvPath, excelCsv, 'utf8');
  fs.writeFileSync(rawCsvPath, rawCsv, 'utf8');
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log(JSON.stringify({
    count: rows.length,
    outreachTargetCount,
    sentCount,
    skippedCount,
    exemptions: appliedExemptions,
    excelCsvPath,
    rawCsvPath,
    mdPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

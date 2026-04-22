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

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isTestAccount(row) {
  return /QA|테스트|TEST/i.test(String(row.affiliation ?? '')) || /QA|테스트|TEST/i.test(String(row.name ?? ''));
}

function isOperationalFc(row, adminPhones, managerPhones) {
  const phone = String(row.phone ?? '');
  const name = String(row.name ?? '').trim();
  const affiliation = String(row.affiliation ?? '');

  return /^\d{11}$/.test(phone)
    && name.length > 0
    && !affiliation.includes('설계매니저')
    && !adminPhones.has(phone)
    && !managerPhones.has(phone)
    && !isTestAccount(row);
}

function resolveReportDate() {
  const explicitArg = process.argv.find((arg) => arg.startsWith('--date='));
  if (explicitArg) {
    return explicitArg.slice('--date='.length);
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
  }).format(new Date());
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    date: resolveReportDate(),
    suffix: '',
    excludeManagerNames: false,
    excludeNames: new Set(),
  };

  for (const arg of args) {
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

async function main() {
  const options = parseArgs();
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

  const reportDate = options.date;

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

  const adminPhones = new Set((adminRows ?? []).map((row) => String(row.phone ?? '')));
  const managerPhones = new Set((managerRows ?? []).map((row) => String(row.phone ?? '')));
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
    .map((row) => ({
      phone: String(row.phone ?? ''),
      name: String(row.name ?? ''),
      affiliation: String(row.affiliation ?? ''),
      legacyRecommenderDisplay: String(row.recommender ?? ''),
    }));

  const reportsDir = path.join(repoRoot, '.codex', 'harness', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const suffixSegment = options.suffix ? `-${options.suffix}` : '';
  const baseName = `fc-missing-recommender-${reportDate}${suffixSegment}`;
  const excelCsvPath = path.join(reportsDir, `${baseName}.csv`);
  const rawCsvPath = path.join(reportsDir, `${baseName}.raw.csv`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);
  const appliedExemptions = [
    ...(options.excludeManagerNames ? ['본부장 이름 예외'] : []),
    ...Array.from(options.excludeNames).map((name) => `${name} 예외`),
  ];

  const excelCsv = [
    ['phone', 'name', 'affiliation', 'legacy_recommender_display'].join(','),
    ...rows.map((row) => [
      toExcelTextFormula(row.phone),
      row.name,
      row.affiliation,
      row.legacyRecommenderDisplay,
    ].map(csvEscape).join(',')),
  ].join('\n');

  const rawCsv = [
    ['phone', 'name', 'affiliation', 'legacy_recommender_display'].join(','),
    ...rows.map((row) => [
      row.phone,
      row.name,
      row.affiliation,
      row.legacyRecommenderDisplay,
    ].map(csvEscape).join(',')),
  ].join('\n');

  const md = [
    '# 추천인 미등록 FC 목록',
    '',
    `- 조회일: ${reportDate}`,
    '- 기준: `signup_completed = true`, `recommender_fc_id IS NULL`, 유효한 11자리 전화번호, 관리자/매니저/설계매니저 제외, QA/테스트 계정 제외',
    ...(appliedExemptions.length > 0 ? [`- 추가 예외: ${appliedExemptions.join(', ')}`] : []),
    `- 건수: ${rows.length}`,
    '- CSV 안내: 기본 CSV는 엑셀/스프레드시트에서 전화번호가 과학적 표기법으로 바뀌지 않도록 텍스트 강제 형식으로 저장됩니다.',
    '',
    '| 전화번호 | 이름 | 소속 |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.phone} | ${row.name} | ${row.affiliation} |`),
    '',
    `- 참고: 이 중 ${rows.filter((row) => row.legacyRecommenderDisplay).length}명은 예전 display용 추천인 문자열은 있지만 structured recommender 연결은 없습니다.`,
  ].join('\n');

  fs.writeFileSync(excelCsvPath, excelCsv, 'utf8');
  fs.writeFileSync(rawCsvPath, rawCsv, 'utf8');
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log(JSON.stringify({
    count: rows.length,
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

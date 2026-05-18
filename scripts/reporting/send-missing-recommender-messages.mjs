import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ADMIN_CHAT_ID = 'admin';

const DEFAULT_MESSAGES = {
  missing_candidate: '안녕하세요. 추천인 정보가 아직 등록되지 않았습니다. 가람in 앱의 추천인 코드 페이지에서 추천인을 검색해 등록해 주세요. 추천인이 기억나지 않으면 소속 본부에 먼저 확인 부탁드립니다.',
  self_referral: '안녕하세요. 현재 추천인 정보가 본인 이름으로 남아 있어 그대로는 등록할 수 없습니다. 가람in 앱의 추천인 코드 페이지에서 실제 추천인을 검색해 다시 등록해 주세요. 추천인이 기억나지 않으면 소속 본부에 먼저 확인 부탁드립니다.',
};

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

function normalizeDigits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    senderPhone: '01058006018',
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
    limit: Number.POSITIVE_INFINITY,
  };

  for (const arg of args) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg.startsWith('--sender-phone=')) {
      options.senderPhone = normalizeDigits(arg.slice('--sender-phone='.length));
      continue;
    }

    if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    }
  }

  return options;
}

function buildMessageForReason(reason) {
  return DEFAULT_MESSAGES[reason] ?? DEFAULT_MESSAGES.missing_candidate;
}

function resolveSenderActorId(sender) {
  return sender.staff_type === 'developer'
    ? normalizeDigits(sender.phone)
    : ADMIN_CHAT_ID;
}

function resolveSenderDisplayName(sender) {
  return sender.staff_type === 'developer'
    ? normalizeText(sender.name) || '개발자'
    : '총무팀';
}

function buildExistingMessageKey(receiverId, content) {
  return `${receiverId}::${content}`;
}

function getSeoulDateStartIso(date) {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

function toMarkdown(report) {
  return [
    '# 추천인 미등록 안내 메시지 발송 결과',
    '',
    `- 기준일: ${report.date}`,
    `- 실행 시각: ${report.executedAt}`,
    `- 실제 발송: ${report.apply ? '예' : '아니오(미리보기)'}`,
    `- 발신 계정: ${report.sender.phone} / ${report.sender.name} / ${report.sender.staff_type ?? 'admin'}`,
    `- 메신저 발신자 식별자: ${report.sender.actorId}`,
    `- 대상 수: ${report.summary.totalTargets}`,
    `- 신규 발송 수: ${report.summary.sentCount}`,
    `- 기존 동일 메시지로 건너뜀: ${report.summary.skippedExistingCount}`,
    `- 실패 수: ${report.summary.failedCount}`,
    '',
    '| 전화번호 | 이름 | 소속 | 차단 사유 | 발송 상태 | 발송 시각 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.items.map((item) => `| ${item.inviteePhone} | ${item.inviteeName} | ${item.inviteeAffiliation} | ${item.blockReason} | ${item.status} | ${item.createdAt ?? ''} |`),
    '',
    '## 문구',
    '',
    `- 후보 없음: ${DEFAULT_MESSAGES.missing_candidate}`,
    `- 자기추천: ${DEFAULT_MESSAGES.self_referral}`,
  ].join('\n');
}

async function main() {
  const options = parseArgs();
  const repoRoot = process.cwd();
  const env = loadEnv(path.join(repoRoot, '.env.local'));

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local');
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const reconciliationPath = path.join(
    repoRoot,
    '.codex',
    'harness',
    'reports',
    `legacy-recommender-reconcile-${options.date}.json`,
  );

  if (!fs.existsSync(reconciliationPath)) {
    throw new Error(`Reconciliation report not found: ${reconciliationPath}`);
  }

  const reconciliation = JSON.parse(fs.readFileSync(reconciliationPath, 'utf8'));
  const blockedItems = Array.isArray(reconciliation.blocked) ? reconciliation.blocked : [];
  const limitedBlockedItems = blockedItems.slice(0, options.limit);

  const { data: sender, error: senderError } = await supabase
    .from('admin_accounts')
    .select('id,phone,name,staff_type')
    .eq('phone', options.senderPhone)
    .maybeSingle();

  if (senderError) {
    throw senderError;
  }

  if (!sender) {
    throw new Error(`Sender account not found: ${options.senderPhone}`);
  }

  const senderActorId = resolveSenderActorId(sender);
  const senderDisplayName = resolveSenderDisplayName(sender);

  const targets = limitedBlockedItems
    .map((item) => ({
      inviteeFcId: item.inviteeFcId,
      inviteePhone: normalizeDigits(item.inviteePhone),
      inviteeName: normalizeText(item.inviteeName),
      inviteeAffiliation: normalizeText(item.inviteeAffiliation),
      legacyRecommenderName: normalizeText(item.legacyRecommenderName),
      blockReason: normalizeText(item.blockReason),
      content: buildMessageForReason(item.blockReason),
    }))
    .filter((item) => item.inviteePhone.length === 11);

  const existingMessageMap = new Map();
  if (targets.length > 0) {
    const existingContents = Array.from(new Set(targets.map((item) => item.content)));
    const existingReceiverIds = Array.from(new Set(targets.map((item) => item.inviteePhone)));
    const { data: existingRows, error: existingError } = await supabase
      .from('messages')
      .select('id,receiver_id,content,created_at')
      .eq('sender_id', senderActorId)
      .gte('created_at', getSeoulDateStartIso(options.date))
      .in('receiver_id', existingReceiverIds)
      .in('content', existingContents)
      .order('created_at', { ascending: false });

    if (existingError) {
      throw existingError;
    }

    for (const row of existingRows ?? []) {
      const key = buildExistingMessageKey(normalizeDigits(row.receiver_id), normalizeText(row.content));
      if (!existingMessageMap.has(key)) {
        existingMessageMap.set(key, row);
      }
    }
  }

  const items = targets.map((item) => {
    const existing = existingMessageMap.get(buildExistingMessageKey(item.inviteePhone, normalizeText(item.content))) ?? null;
    return {
      ...item,
      status: existing ? '기존 메시지 있음' : options.apply ? '발송 대기' : '미리보기',
      existingMessageId: existing?.id ?? null,
      existingCreatedAt: existing?.created_at ?? null,
      messageId: null,
      createdAt: existing?.created_at ?? null,
      error: null,
    };
  });

  const toInsert = items.filter((item) => !item.existingMessageId);

  if (options.apply && toInsert.length > 0) {
    const batchSize = 50;
    for (let index = 0; index < toInsert.length; index += batchSize) {
      const batch = toInsert.slice(index, index + batchSize);
      const { data: insertedRows, error: insertError } = await supabase
        .from('messages')
        .insert(batch.map((item) => ({
          sender_id: senderActorId,
          receiver_id: item.inviteePhone,
          content: item.content,
          message_type: 'text',
          is_read: false,
          file_url: null,
          file_name: null,
          file_size: null,
        })))
        .select('id,receiver_id,content,created_at');

      if (insertError) {
        for (const target of batch) {
          target.status = '발송 실패';
          target.error = insertError.message;
        }
        continue;
      }

      const insertedMap = new Map(
        (insertedRows ?? []).map((row) => [
          buildExistingMessageKey(normalizeDigits(row.receiver_id), normalizeText(row.content)),
          row,
        ]),
      );

      for (const target of batch) {
        const inserted = insertedMap.get(buildExistingMessageKey(target.inviteePhone, normalizeText(target.content))) ?? null;
        if (inserted) {
          target.status = '전송 완료';
          target.messageId = inserted.id;
          target.createdAt = inserted.created_at;
        } else {
          target.status = '발송 실패';
          target.error = 'inserted row not returned';
        }
      }
    }
  }

  const summary = {
    totalTargets: items.length,
    sentCount: items.filter((item) => item.status === '전송 완료').length,
    skippedExistingCount: items.filter((item) => item.status === '기존 메시지 있음').length,
    failedCount: items.filter((item) => item.status === '발송 실패').length,
  };

  const report = {
    executedAt: new Date().toISOString(),
    apply: options.apply,
    date: options.date,
    sender: {
      id: sender.id,
      phone: normalizeDigits(sender.phone),
      name: normalizeText(sender.name),
      staff_type: sender.staff_type ?? 'admin',
      actorId: senderActorId,
      displayName: senderDisplayName,
    },
    summary,
    messages: DEFAULT_MESSAGES,
    items,
  };

  const reportsDir = path.join(repoRoot, '.codex', 'harness', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, `missing-recommender-message-send-${options.date}.json`);
  const mdPath = path.join(reportsDir, `missing-recommender-message-send-${options.date}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, toMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    senderActorId,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

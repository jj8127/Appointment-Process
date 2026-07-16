import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  buildVerifiedBoardActor,
  isBoardAutomationActionAllowed,
  verifyBoardAutomationToken,
} from './board-actor-policy.ts';
import { requireAppSessionFromRequest } from './request-board-auth.ts';
import { reportEdgeDiagnostic } from './edge-diagnostic.ts';

export type Role = 'admin' | 'manager' | 'fc';
export type BoardDisplayRole = Role | 'developer';

export type Actor = {
  role: Role;
  residentId: string;
  displayName?: string;
};

export type ActorCheck =
  | { ok: true; actor: Actor; authMode: 'app' | 'automation' }
  | { ok: false; response: Response };

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const defaultOrigin = allowedOrigins[0] ?? 'https://yourdomain.com';

export function resolveCorsOrigin(origin?: string) {
  if (origin && allowedOrigins.includes(origin)) return origin;
  // Allow localhost for development
  if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) return origin;
  return defaultOrigin;
}

export function buildCorsHeaders(origin?: string) {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey, x-app-session-token, x-board-automation-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, serviceKey);

export function json(body: Record<string, unknown>, status = 200, origin?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(origin) },
  });
}

export function fail(code: string, message: string, status = 400, origin?: string) {
  return json({ ok: false, code, message }, status, origin);
}

/** DB 에러를 서버 로그에만 기록하고, 클라이언트에는 일반화된 메시지만 반환 */
export function dbError(err: { message?: string }, origin?: string) {
  void err;
  reportEdgeDiagnostic({
    event: 'board.database_operation',
    reason: 'database_operation_failed',
    errorClass: 'database',
  });
  return json({ ok: false, code: 'db_error', message: '데이터베이스 오류가 발생했습니다.' }, 500, origin);
}

export function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

const SECRET_ASSIGNMENT_PATTERN =
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE_KEY|AUTH_TOKEN|API_KEY)\b\s*=\s*[^\s"'`<>]+/gi;
const LONG_HEX_TOKEN_PATTERN = /\b[a-f0-9]{32,}\b/gi;

export function redactSensitiveText(value?: string | null, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
      const key = match.split('=')[0]?.trim() || 'SECRET';
      return `${key}=[redacted]`;
    })
    .replace(LONG_HEX_TOKEN_PATTERN, '[redacted]')
    .trim();
}

export async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function requireActor(
  req: Request,
  payload: { actor?: Actor },
  action: string,
  origin?: string,
): Promise<ActorCheck> {
  const providedAutomationToken = req.headers.get('x-board-automation-token')?.trim() ?? '';
  if (providedAutomationToken) {
    const expectedAutomationToken = getEnv('BOARD_AUTOMATION_TOKEN')?.trim() ?? '';
    if (!expectedAutomationToken) {
      return { ok: false, response: fail('automation_unavailable', 'board automation is not configured', 503, origin) };
    }
    if (!verifyBoardAutomationToken(providedAutomationToken, expectedAutomationToken)) {
      return { ok: false, response: fail('invalid_automation_token', 'invalid board automation token', 401, origin) };
    }
    if (!isBoardAutomationActionAllowed(action)) {
      return { ok: false, response: fail('automation_forbidden', 'board automation action is not allowed', 403, origin) };
    }

    const automationPhone = cleanPhone(getEnv('BOARD_AUTOMATION_ACTOR_PHONE') ?? '');
    if (automationPhone.length !== 11) {
      return { ok: false, response: fail('automation_unavailable', 'board automation actor is not configured', 503, origin) };
    }
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,active')
      .eq('phone', automationPhone)
      .eq('active', true)
      .maybeSingle();
    if (error) return { ok: false, response: dbError(error, origin) };
    if (!data?.id || !data.active || cleanPhone(data.phone ?? '') !== automationPhone) {
      return { ok: false, response: fail('actor_not_found', 'automation admin account not found', 403, origin) };
    }

    const automationName = redactSensitiveText(
      getEnv('BOARD_AUTOMATION_ACTOR_NAME') ?? data.name ?? '',
    ).trim();
    const policyResult = buildVerifiedBoardActor({
      role: 'admin',
      residentId: automationPhone,
      displayName: automationName,
    });
    if (policyResult.ok === false) {
      return {
        ok: false,
        response: fail(policyResult.code, policyResult.message, policyResult.status, origin),
      };
    }
    return { ok: true, actor: policyResult.actor, authMode: 'automation' };
  }

  const sessionResult = await requireAppSessionFromRequest(req);
  if (sessionResult.ok === false) {
    return {
      ok: false,
      response: fail(
        sessionResult.code,
        '게시판 기능을 사용하려면 다시 로그인해주세요.',
        sessionResult.status,
        origin,
      ),
    };
  }

  const role = sessionResult.session.role;
  const residentId = cleanPhone(sessionResult.session.phone);
  if (residentId.length !== 11) {
    return { ok: false, response: fail('invalid_session_actor', 'invalid signed board session actor', 401, origin) };
  }

  let canonicalName = '';
  if (role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,active')
      .eq('phone', residentId)
      .eq('active', true)
      .maybeSingle();
    if (error) {
      return { ok: false, response: dbError(error, origin) };
    }
    if (!data?.id || !data.active || cleanPhone(data.phone ?? '') !== residentId) {
      return { ok: false, response: fail('actor_not_found', 'admin account not found', 403, origin) };
    }
    canonicalName = redactSensitiveText(data.name ?? '').trim();
  } else if (role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id,name,phone,active')
      .eq('phone', residentId)
      .eq('active', true)
      .maybeSingle();
    if (error) {
      return { ok: false, response: dbError(error, origin) };
    }
    if (!data?.id || !data.active || cleanPhone(data.phone ?? '') !== residentId) {
      return { ok: false, response: fail('actor_not_found', 'manager account not found', 403, origin) };
    }
    canonicalName = redactSensitiveText(data.name ?? '').trim();
  } else {
    const query = supabase
      .from('fc_profiles')
      .select('id,name,phone,signup_completed');
    const { data, error } = sessionResult.session.fcId
      ? await query.eq('id', sessionResult.session.fcId).maybeSingle()
      : await query.eq('phone', residentId).maybeSingle();
    if (error) {
      return { ok: false, response: dbError(error, origin) };
    }
    if (
      !data?.id
      || data.signup_completed !== true
      || cleanPhone(data.phone ?? '') !== residentId
    ) {
      return { ok: false, response: fail('actor_not_found', 'completed FC profile not found', 403, origin) };
    }
    canonicalName = redactSensitiveText(data.name ?? '').trim();
  }

  const policyResult = buildVerifiedBoardActor(
    { role, residentId, displayName: canonicalName },
    payload.actor,
  );
  if (policyResult.ok === false) {
    return {
      ok: false,
      response: fail(policyResult.code, policyResult.message, policyResult.status, origin),
    };
  }

  return { ok: true, actor: policyResult.actor, authMode: 'app' };
}

export function requireRole(actor: Actor, roles: Role[], origin?: string) {
  if (!roles.includes(actor.role)) {
    return fail('forbidden', 'insufficient permissions', 403, origin);
  }
  return null;
}

export const ATTACHMENT_LIMITS = {
  maxFiles: 20,
  maxTotalBytes: 100 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
};

export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function previewContent(content: string, max = 140) {
  const normalized = redactSensitiveText(content ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export async function resolveDeveloperResidentIds(rows: Array<{ author_role?: string | null; author_resident_id?: string | null }>) {
  const adminResidentIds = Array.from(
    new Set(
      rows
        .filter((row) => row.author_role === 'admin')
        .map((row) => cleanPhone(row.author_resident_id ?? ''))
        .filter((residentId) => residentId.length === 11),
    ),
  );

  if (adminResidentIds.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from('admin_accounts')
    .select('phone,staff_type,active')
    .in('phone', adminResidentIds)
    .eq('active', true);

  if (error) throw error;

  return new Set(
    (data ?? [])
      .filter((row) => row.staff_type === 'developer')
      .map((row) => cleanPhone(row.phone))
      .filter((residentId) => residentId.length === 11),
  );
}

export function toBoardDisplayRole(
  authorRole: string | null | undefined,
  authorResidentId: string | null | undefined,
  developerResidentIds: Set<string>,
): BoardDisplayRole {
  if (authorRole === 'admin') {
    const residentId = cleanPhone(authorResidentId ?? '');
    if (developerResidentIds.has(residentId)) return 'developer';
    return 'admin';
  }
  if (authorRole === 'manager') return 'manager';
  return 'fc';
}

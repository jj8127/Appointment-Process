import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export type Role = 'admin' | 'manager' | 'fc';

export type Actor = {
  role: Role;
  residentId: string;
  displayName?: string;
};

export type ActorCheck =
  | { ok: true; actor: Actor }
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
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

export function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

export async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function requireActor(payload: { actor?: Actor }, origin?: string): Promise<ActorCheck> {
  if (!payload?.actor) {
    return { ok: false, response: fail('missing_actor', 'actor is required', 400, origin) };
  }

  const role = payload.actor.role;
  const residentId = cleanPhone(payload.actor.residentId ?? '');
  const displayName = (payload.actor.displayName ?? '').trim();

  if (!role || !residentId) {
    return { ok: false, response: fail('invalid_actor', 'invalid actor payload', 400, origin) };
  }
  if (residentId.length !== 11) {
    return { ok: false, response: fail('invalid_resident_id', 'residentId must be 11 digits', 400, origin) };
  }
  if (!['admin', 'manager', 'fc'].includes(role)) {
    return { ok: false, response: fail('invalid_role', 'invalid actor role', 400, origin) };
  }

  if (role === 'admin') {
    const { data, error } = await supabase
      .from('admin_accounts')
      .select('id,name,phone,active')
      .eq('phone', residentId)
      .maybeSingle();
    if (error) {
      return { ok: false, response: fail('db_error', error.message, 500, origin) };
    }
    if (!data?.id || !data.active) {
      return { ok: false, response: fail('actor_not_found', 'admin account not found', 403, origin) };
    }
    return {
      ok: true,
      actor: {
        role,
        residentId,
        displayName: displayName || data.name || '',
      },
    };
  }

  if (role === 'manager') {
    const { data, error } = await supabase
      .from('manager_accounts')
      .select('id,name,phone,active')
      .eq('phone', residentId)
      .maybeSingle();
    if (error) {
      return { ok: false, response: fail('db_error', error.message, 500, origin) };
    }
    if (!data?.id || !data.active) {
      return { ok: false, response: fail('actor_not_found', 'manager account not found', 403, origin) };
    }
    return {
      ok: true,
      actor: {
        role,
        residentId,
        displayName: displayName || data.name || '',
      },
    };
  }

  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id,name,phone')
    .eq('phone', residentId)
    .maybeSingle();
  if (error) {
    return { ok: false, response: fail('db_error', error.message, 500, origin) };
  }
  if (!data?.id) {
    return { ok: false, response: fail('actor_not_found', 'fc profile not found', 403, origin) };
  }

  return {
    ok: true,
    actor: {
      role,
      residentId,
      displayName: displayName || data.name || '',
    },
  };
}

export function requireRole(actor: Actor, roles: Role[], origin?: string) {
  if (!roles.includes(actor.role)) {
    return fail('forbidden', 'insufficient permissions', 403, origin);
  }
  return null;
}

export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxTotalBytes: 100 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
};

export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function previewContent(content: string, max = 140) {
  const normalized = (content ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  residentId: string;
  residentFront?: string;
  residentBack?: string;
  address: string;
  addressDetail?: string | null;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

// Security: Restrict CORS to specific origins
const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

// Security: Validate required environment variables
const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const identityKey = getEnv('FC_IDENTITY_KEY');
const hashSalt = getEnv('FC_IDENTITY_HASH_SALT');

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}
if (!serviceKey) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}
if (!identityKey || identityKey.length < 32) {
  throw new Error('Missing or invalid FC_IDENTITY_KEY (must be at least 32 characters)');
}
if (!hashSalt || hashSalt.length < 16) {
  throw new Error('Missing or invalid FC_IDENTITY_HASH_SALT (must be at least 16 characters)');
}

const supabase = createClient(supabaseUrl, serviceKey);

const textEncoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromBase64(input: string) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importAesKey(base64Key: string) {
  const raw = fromBase64(base64Key);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encrypt(value: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(value);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

async function sha256Base64(value: string) {
  const bytes = textEncoder.encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return toBase64(hash);
}

function isValidResidentChecksum(front: string, back: string) {
  const digits = `${front}${back}`;
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(message, { status, headers: corsHeaders });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }

  if (!identityKey) {
    return err('FC_IDENTITY_KEY is required', 500);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON', 400);
  }

  const residentId = (body.residentId ?? '').replace(/[^0-9]/g, '');
  const residentFront = (body.residentFront ?? '').replace(/[^0-9]/g, '');
  const residentBack = (body.residentBack ?? '').replace(/[^0-9]/g, '');
  const address = (body.address ?? '').trim();
  const addressDetail = (body.addressDetail ?? '').trim();

  if (!residentId || !address) {
    return err('Invalid payload', 400);
  }
  const hasResidentInput = residentFront.length > 0 || residentBack.length > 0;
  if (hasResidentInput) {
    if (residentFront.length !== 6 || residentBack.length !== 7) {
      return err('Invalid payload', 400);
    }
    if (!isValidResidentChecksum(residentFront, residentBack)) {
      return err('Invalid resident number', 400);
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id,resident_id_masked,resident_id_hash')
    .eq('phone', residentId)
    .maybeSingle();

  if (profileError || !profile?.id) {
    return err('FC profile not found', 404);
  }

  if (!hasResidentInput && !profile.resident_id_masked && !profile.resident_id_hash) {
    return err('Resident number required', 400);
  }

  if (!hasResidentInput) {
    const { data: secureRow, error: secureReadError } = await supabase
      .from('fc_identity_secure')
      .select('fc_id')
      .eq('fc_id', profile.id)
      .maybeSingle();
    if (secureReadError) {
      return err(secureReadError.message, 500);
    }
    if (!secureRow?.fc_id) {
      return err('Resident number required', 400);
    }
  }

  const key = await importAesKey(identityKey);
  const addressEncrypted = await encrypt(address, key);
  const addressDetailEncrypted = addressDetail ? await encrypt(addressDetail, key) : null;

  if (hasResidentInput) {
    const residentNumber = `${residentFront}${residentBack}`;
    const masked = `${residentFront}-${'*'.repeat(7)}`;
    const hash = await sha256Base64(`${residentNumber}${hashSalt}`);
    const residentEncrypted = await encrypt(residentNumber, key);

    const { error: secureError } = await supabase
      .from('fc_identity_secure')
      .upsert(
        {
          fc_id: profile.id,
          resident_number_encrypted: residentEncrypted,
          address_encrypted: addressEncrypted,
          address_detail_encrypted: addressDetailEncrypted,
        },
        { onConflict: 'fc_id' },
      );
    if (secureError) {
      return err(secureError.message, 500);
    }

    const { error: updateError } = await supabase
      .from('fc_profiles')
      .update({
        resident_id_masked: masked,
        resident_id_hash: hash,
        address,
        address_detail: addressDetail || null,
        identity_completed: true,
      })
      .eq('id', profile.id);

    if (updateError) {
      return err(updateError.message, 500);
    }

    return ok({ ok: true });
  }

  const { error: secureError } = await supabase
    .from('fc_identity_secure')
    .update({
      address_encrypted: addressEncrypted,
      address_detail_encrypted: addressDetailEncrypted,
    })
    .eq('fc_id', profile.id);
  if (secureError) {
    return err(secureError.message, 500);
  }

  const { error: updateError } = await supabase
    .from('fc_profiles')
    .update({
      address,
      address_detail: addressDetail || null,
      identity_completed: true,
    })
    .eq('id', profile.id);

  if (updateError) {
    return err(updateError.message, 500);
  }

  return ok({ ok: true });
});

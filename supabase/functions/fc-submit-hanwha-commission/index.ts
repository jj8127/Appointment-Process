import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
  phone: string;
  hanwha_commission_date_sub: string;
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl!, serviceKey!);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

function cleanPhone(input: string) {
  return (input ?? '').replace(/[^0-9]/g, '');
}

function isValidYmd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function trimOrNull(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return fail('Method not allowed', 405);
    }
    if (!supabaseUrl || !serviceKey) {
      return fail('Missing Supabase credentials', 500);
    }

    let body: Payload;
    try {
      body = (await req.json()) as Payload;
    } catch {
      return fail('Invalid JSON');
    }

    const phone = cleanPhone(body.phone ?? '');
    if (phone.length !== 11) {
      return fail('Phone number must be 11 digits.');
    }

    const submissionDate = trimOrNull(body.hanwha_commission_date_sub);
    if (!submissionDate || !isValidYmd(submissionDate)) {
      return fail('Invalid Hanwha commission date.');
    }

    const { data: profile, error: profileError } = await supabase
      .from('fc_profiles')
      .select('id,name,status,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
      .eq('phone', phone)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, message: profileError.message }, 500);
    }
    if (!profile?.id) {
      return json({ ok: false, message: 'Profile not found.' }, 404);
    }

    if (['appointment-completed', 'final-link-sent'].includes(String(profile.status ?? ''))) {
      return fail('Legacy terminal profiles cannot re-enter the Hanwha review flow.');
    }
    if (!['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected'].includes(String(profile.status ?? ''))) {
      return fail('Hanwha commission can only be submitted after docs approval.');
    }

    const updatePayload: Record<string, unknown> = {
      hanwha_commission_date_sub: submissionDate,
      hanwha_commission_date: null,
      hanwha_commission_reject_reason: null,
      hanwha_commission_pdf_path: null,
      hanwha_commission_pdf_name: null,
      status: 'hanwha-commission-review',
    };

    const { data: updated, error: updateError } = await supabase
      .from('fc_profiles')
      .update(updatePayload)
      .eq('id', profile.id)
      .select('id,name,status,hanwha_commission_date_sub,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
      .maybeSingle();

    if (updateError) {
      return json({ ok: false, message: updateError.message }, 500);
    }

    return json({
      ok: true,
      data: updated ?? { id: profile.id, name: profile.name ?? '' },
    });
  } catch (err: any) {
    return fail(err?.message ?? '한화 위촉 정보를 저장하지 못했습니다.', 500);
  }
});

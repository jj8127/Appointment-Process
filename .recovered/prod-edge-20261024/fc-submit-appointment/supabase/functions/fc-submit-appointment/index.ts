import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { canSubmitInsuranceCommission } from '../_shared/commission.ts';

type Payload = {
  phone: string;
  date_field: string;
  date_value: string;
  type: 'life' | 'nonlife';
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

function getExpectedDateField(type: Payload['type']) {
  return type === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return json({ ok: false, message: 'Method not allowed' }, 405);
    }
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, message: 'Missing Supabase credentials' }, 500);
    }

    let body: Payload;
    try {
      body = (await req.json()) as Payload;
    } catch {
      return json({ ok: false, message: 'Invalid JSON' }, 400);
    }

    const phone = cleanPhone(body.phone ?? '');
    if (phone.length !== 11) {
      return json({ ok: false, message: 'Phone number must be 11 digits.' }, 400);
    }

    const expectedDateField = getExpectedDateField(body.type);
    if (!body.type || body.date_field !== expectedDateField) {
      return json({ ok: false, message: 'Invalid date field for commission type.' }, 400);
    }

    const dateValue = (body.date_value ?? '').trim();
    if (!dateValue || !isValidYmd(dateValue)) {
      return json({ ok: false, message: 'Invalid appointment date.' }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from('fc_profiles')
      .select(
        'id,status,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed',
      )
      .eq('phone', phone)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, message: profileError.message }, 500);
    }
    if (!profile?.id) {
      return json({ ok: false, message: 'Profile not found.' }, 404);
    }

    if (!canSubmitInsuranceCommission(profile)) {
      return json(
        {
          ok: false,
          message: 'Dawichok URL approval and PDF file are required before submitting insurance commission dates.',
        },
        409,
      );
    }

    const updateData: Record<string, unknown> = {
      [expectedDateField]: dateValue,
    };

    if (body.type === 'life') {
      updateData.appointment_reject_reason_life = null;
    } else {
      updateData.appointment_reject_reason_nonlife = null;
    }

    const { data, error } = await supabase
      .from('fc_profiles')
      .update(updateData)
      .eq('id', profile.id)
      .select()
      .single();

    if (error) {
      return json({ ok: false, message: error.message }, 500);
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return json({ ok: false, message: err?.message ?? '보험 위촉 정보를 저장하지 못했습니다.' }, 500);
  }
});

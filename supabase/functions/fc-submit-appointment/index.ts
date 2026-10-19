import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { canSubmitInsuranceCommission } from '../_shared/commission.ts';
import {
  hasMismatchedClaimedPhone,
  isExactYmd,
  requireFcSelfServiceActor,
} from '../_shared/fc-self-service-auth.ts';

type Payload = {
  phone?: string;
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
  'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : 'https://yourdomain.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
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

function getExpectedDateField(type: Payload['type']) {
  return type === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405);
    }
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, code: 'server_misconfigured', message: '서비스 설정을 확인할 수 없습니다.' }, 500);
    }

    const auth = await requireFcSelfServiceActor(req);
    if (auth.ok === false) {
      return json({ ok: false, code: auth.code, message: auth.message }, auth.status);
    }

    let body: Payload;
    try {
      body = (await req.json()) as Payload;
    } catch {
      return json({ ok: false, code: 'invalid_json', message: '요청 형식이 올바르지 않습니다.' }, 400);
    }

    if (hasMismatchedClaimedPhone(auth.actor, body.phone)) {
      return json({ ok: false, code: 'actor_mismatch', message: '로그인 정보와 요청 정보가 일치하지 않습니다.' }, 403);
    }

    const expectedDateField = getExpectedDateField(body.type);
    if (!body.type || body.date_field !== expectedDateField) {
      return json({ ok: false, code: 'invalid_date_field', message: '보험 유형과 완료일 항목이 일치하지 않습니다.' }, 400);
    }

    const dateValue = (body.date_value ?? '').trim();
    if (!dateValue || !isExactYmd(dateValue)) {
      return json({ ok: false, code: 'invalid_appointment_date', message: '유효한 위촉 완료일을 입력해주세요.' }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from('fc_profiles')
      .select(
        'id,status,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed',
      )
      .eq('id', auth.actor.id)
      .eq('phone', auth.actor.phone)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, code: 'read_failed', message: '위촉 정보를 확인하지 못했습니다.' }, 503);
    }
    if (!profile?.id) {
      return json({ ok: false, code: 'profile_not_found', message: 'FC 정보를 찾을 수 없습니다.' }, 404);
    }

    if (!canSubmitInsuranceCommission(profile)) {
      return json(
        {
          ok: false,
          code: 'prerequisite_missing',
          message: '다위촉 승인과 PDF 등록이 완료된 후 위촉 완료일을 제출할 수 있습니다.',
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
      .eq('id', auth.actor.id)
      .eq('phone', auth.actor.phone)
      .in('status', ['hanwha-commission-approved', 'appointment-completed', 'final-link-sent'])
      .select('id,name')
      .maybeSingle();

    if (error) {
      return json({ ok: false, code: 'write_failed', message: '보험 위촉 정보를 저장하지 못했습니다.' }, 503);
    }
    if (!data?.id) {
      return json({ ok: false, code: 'workflow_changed', message: '진행 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요.' }, 409);
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return json({ ok: false, code: 'request_failed', message: '보험 위촉 정보를 저장하지 못했습니다.' }, 500);
  }
});

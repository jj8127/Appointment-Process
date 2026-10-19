import { serveWithConfiguredCors as serve } from '../_shared/serve-with-cors.ts';
// eslint-disable-next-line import/no-unresolved
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  hasMismatchedClaimedPhone,
  isExactYmd,
  requireFcSelfServiceActor,
} from '../_shared/fc-self-service-auth.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  phone?: string;
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

function fail(code: string, message: string, status = 400) {
  return json({ ok: false, code, message }, status);
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
      return fail('method_not_allowed', 'Method not allowed', 405);
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

    const submissionDate = trimOrNull(body.hanwha_commission_date_sub);
    if (!submissionDate || !isExactYmd(submissionDate)) {
      return json({ ok: false, code: 'invalid_submission_date', message: '유효한 다위촉 완료일을 입력해주세요.' }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from('fc_profiles')
      .select('id,name,status,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
      .eq('id', auth.actor.id)
      .eq('phone', auth.actor.phone)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, code: 'read_failed', message: '다위촉 정보를 확인하지 못했습니다.' }, 503);
    }
    if (!profile?.id) {
      return json({ ok: false, code: 'profile_not_found', message: 'FC 정보를 찾을 수 없습니다.' }, 404);
    }

    if (['appointment-completed', 'final-link-sent'].includes(String(profile.status ?? ''))) {
      return fail('workflow_locked', '완료된 위촉 절차는 다시 제출할 수 없습니다.', 409);
    }
    if (!['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected'].includes(String(profile.status ?? ''))) {
      return fail('prerequisite_missing', '서류 승인 후 다위촉 완료일을 제출할 수 있습니다.', 409);
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
      .eq('id', auth.actor.id)
      .eq('phone', auth.actor.phone)
      .in('status', ['docs-approved', 'hanwha-commission-review', 'hanwha-commission-rejected'])
      .select('id,name,status,hanwha_commission_date_sub,hanwha_commission_pdf_path,hanwha_commission_pdf_name')
      .maybeSingle();

    if (updateError) {
      return json({ ok: false, code: 'write_failed', message: '다위촉 정보를 저장하지 못했습니다.' }, 503);
    }
    if (!updated?.id) {
      return json({ ok: false, code: 'workflow_changed', message: '진행 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요.' }, 409);
    }
    try {
      requireMutationRowReceipt(updated, {
        id: profile.id,
        status: 'hanwha-commission-review',
        hanwha_commission_date_sub: submissionDate,
        hanwha_commission_pdf_path: null,
        hanwha_commission_pdf_name: null,
      });
    } catch {
      return fail(
        'mutation_receipt_unverified',
        '다위촉 URL 저장 결과를 확인하지 못했습니다. 다시 시도해주세요.',
        502,
      );
    }

    return json({
      ok: true,
      data: updated,
    });
  } catch {
    return json({ ok: false, code: 'request_failed', message: '다위촉 정보를 저장하지 못했습니다.' }, 500);
  }
});

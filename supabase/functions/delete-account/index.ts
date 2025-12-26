import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = { residentId: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, serviceKey);

function ok(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function ignoreMissingTable<T>(result: { error: any; data?: T }) {
  if (result.error?.code === '42P01') {
    return { data: result.data };
  }
  if (result.error) {
    throw result.error;
  }
  return result;
}

function formatPhone(digits: string) {
  if (!digits) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return err('Method not allowed', 405);
  }
  if (!supabaseUrl || !serviceKey) {
    return err('Server misconfigured: missing Supabase credentials', 500);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON', 400);
  }

  const residentId = (body.residentId ?? '').replace(/[^0-9]/g, '');
  if (!residentId) {
    return err('residentId required', 400);
  }
  const residentIdMasked = formatPhone(residentId);

  const { data: profile, error: profileError } = await supabase
    .from('fc_profiles')
    .select('id')
    .eq('phone', residentId)
    .maybeSingle();

  if (profileError) {
    return err(profileError.message, 500);
  }

  if (!profile?.id) {
    return ok({ ok: true, deleted: false });
  }

  const fcId = profile.id as string;

  const docsResult = await ignoreMissingTable(
    await supabase.from('fc_documents').select('storage_path').eq('fc_id', fcId),
  );
  const paths = (docsResult.data ?? []).map((doc: any) => doc.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('fc-documents').remove(paths);
    if (storageError) {
      console.warn('storage remove failed', storageError.message ?? storageError);
    }
  }

  const docsDeleteResult = await ignoreMissingTable(
    await supabase.from('fc_documents').delete().eq('fc_id', fcId),
  );
  if ((docsDeleteResult as any).error) return err((docsDeleteResult as any).error.message, 500);

  await ignoreMissingTable(
    await supabase.from('messages').delete().or(`sender_id.eq.${residentId},receiver_id.eq.${residentId}`),
  );

  await ignoreMissingTable(
    await supabase
      .from('exam_registrations')
      .delete()
      .or(`resident_id.eq.${residentId},resident_id.eq.${residentIdMasked}`),
  );
  await ignoreMissingTable(
    await supabase.from('notifications').delete().or(`resident_id.eq.${residentId},fc_id.eq.${fcId}`),
  );
  await ignoreMissingTable(await supabase.from('device_tokens').delete().eq('resident_id', residentId));
  await ignoreMissingTable(await supabase.from('fc_identity_secure').delete().eq('fc_id', fcId));

  const { error: profileDeleteError } = await supabase.from('fc_profiles').delete().eq('id', fcId);
  if (profileDeleteError) return err(profileDeleteError.message, 500);

  return ok({ ok: true, deleted: true });
});

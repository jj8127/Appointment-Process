import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceKey);

const textDecoder = new TextDecoder();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function fail(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

type ActionRequest = {
  adminPhone: string;
  action: string;
  payload: Record<string, any>;
};

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

async function importAesKeyForDecrypt(base64Key: string) {
  const raw = fromBase64(base64Key);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decrypt(value: string, key: CryptoKey) {
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('Invalid encrypted value');
  const iv = fromBase64(parts[0]);
  const cipher = fromBase64(parts[1]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
  return textDecoder.decode(plain);
}

function isServiceRoleRequest(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : auth;
  return token === serviceKey;
}

async function verifyAdmin(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('admin_accounts')
    .select('id,active')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();
  return !!data?.id;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail('Method not allowed', 405);
  }

  let body: ActionRequest;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON');
  }

  const { adminPhone, action, payload } = body;
  if (!adminPhone || !action) {
    return fail('adminPhone and action are required');
  }

  const isAdmin = await verifyAdmin(adminPhone.replace(/[^0-9]/g, ''));
  if (!isAdmin) {
    return fail('Unauthorized: not an admin', 403);
  }

  try {
    // ── getResidentNumbers (INTERNAL ONLY) ──
    if (action === 'getResidentNumbers') {
      // 주민번호 전체는 극도로 민감한 PII라서, 클라이언트(anon)에서 직접 호출되지 않도록
      // 서버(서비스 롤)에서만 호출 가능하게 제한합니다.
      if (!isServiceRoleRequest(req)) {
        return fail('Unauthorized: internal only', 403);
      }

      const identityKey = getEnv('FC_IDENTITY_KEY');
      if (!identityKey) {
        return fail('Missing FC_IDENTITY_KEY', 500);
      }

      const { fcIds } = payload as { fcIds?: string[] };
      if (!Array.isArray(fcIds) || fcIds.length === 0) return fail('fcIds are required');

      const uniqueFcIds = Array.from(
        new Set(
          fcIds.map((v) => String(v ?? '').trim()).filter(Boolean),
        ),
      );

      const key = await importAesKeyForDecrypt(identityKey);

      const residentNumbers: Record<string, string | null> = {};
      const chunkSize = 100;
      for (let i = 0; i < uniqueFcIds.length; i += chunkSize) {
        const chunk = uniqueFcIds.slice(i, i + chunkSize);
        const { data: rows, error } = await supabase
          .from('fc_identity_secure')
          .select('fc_id,resident_number_encrypted')
          .in('fc_id', chunk);
        if (error) throw error;

        for (const row of rows ?? []) {
          const fcId = (row as any).fc_id as string;
          const enc = (row as any).resident_number_encrypted as string | null;
          if (!fcId || !enc) {
            if (fcId) residentNumbers[fcId] = null;
            continue;
          }

          try {
            const plain = await decrypt(enc, key);
            const digits = plain.replace(/[^0-9]/g, '');
            if (digits.length === 13) {
              residentNumbers[fcId] = `${digits.slice(0, 6)}-${digits.slice(6)}`;
            } else {
              residentNumbers[fcId] = null;
            }
          } catch {
            residentNumbers[fcId] = null;
          }
        }
      }

      // ensure every requested id exists in map
      for (const fcId of uniqueFcIds) {
        if (!(fcId in residentNumbers)) residentNumbers[fcId] = null;
      }

      return json({ ok: true, residentNumbers });
    }

    // ── updateProfile ──
    if (action === 'updateProfile') {
      const { fcId, data } = payload as { fcId: string; data: Record<string, any> };
      if (!fcId || !data) return fail('fcId and data are required');
      const { error } = await supabase.from('fc_profiles').update(data).eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateStatus ──
    if (action === 'updateStatus') {
      const { fcId, status, extra } = payload as {
        fcId: string;
        status: string;
        extra?: Record<string, any>;
      };
      if (!fcId || !status) return fail('fcId and status are required');
      const { error } = await supabase
        .from('fc_profiles')
        .update({ status, ...(extra ?? {}) })
        .eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateAppointmentDate ──
    if (action === 'updateAppointmentDate') {
      const { fcId, type, date, isReject, rejectReason } = payload as {
        fcId: string;
        type: 'life' | 'nonlife';
        date: string | null;
        isReject?: boolean;
        rejectReason?: string | null;
      };
      if (!fcId || !type) return fail('fcId and type are required');

      const field = type === 'life' ? 'appointment_date_life' : 'appointment_date_nonlife';
      const submittedField = type === 'life' ? 'appointment_date_life_sub' : 'appointment_date_nonlife_sub';
      const rejectField = type === 'life' ? 'appointment_reject_reason_life' : 'appointment_reject_reason_nonlife';

      const updatePayload: Record<string, any> = {
        [field]: date,
        [rejectField]: isReject ? rejectReason ?? null : null,
      };
      if (isReject) updatePayload[submittedField] = null;

      const { data: updated, error } = await supabase
        .from('fc_profiles')
        .update(updatePayload)
        .eq('id', fcId)
        .select('appointment_date_life, appointment_date_nonlife')
        .single();
      if (error) throw error;

      const bothSet = Boolean(updated?.appointment_date_life) && Boolean(updated?.appointment_date_nonlife);
      const nextStatus = date === null ? 'docs-approved' : bothSet ? 'final-link-sent' : 'appointment-completed';
      const { error: statusErr } = await supabase.from('fc_profiles').update({ status: nextStatus }).eq('id', fcId);
      if (statusErr) throw statusErr;

      return json({ ok: true, status: nextStatus });
    }

    // ── updateAppointmentSchedule ──
    if (action === 'updateAppointmentSchedule') {
      const { fcId, life, nonlife } = payload as {
        fcId: string;
        life?: string | null;
        nonlife?: string | null;
      };
      if (!fcId) return fail('fcId is required');
      const updatePayload: Record<string, any> = {};
      if (life !== undefined) updatePayload.appointment_schedule_life = life || null;
      if (nonlife !== undefined) updatePayload.appointment_schedule_nonlife = nonlife || null;
      const { error } = await supabase.from('fc_profiles').update(updatePayload).eq('id', fcId);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── updateDocReqs ──
    if (action === 'updateDocReqs') {
      const { fcId, types, deadline, currentDeadline } = payload as {
        fcId: string;
        types: string[];
        deadline?: string | null;
        currentDeadline?: string | null;
      };
      if (!fcId || !Array.isArray(types)) return fail('fcId and types are required');

      const normalizedDeadline = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
      const shouldResetNotify = normalizedDeadline !== (currentDeadline ?? null);

      const { data: currentDocs, error: fetchErr } = await supabase
        .from('fc_documents')
        .select('doc_type,storage_path')
        .eq('fc_id', fcId);
      if (fetchErr) throw fetchErr;

      if (types.length === 0) {
        await supabase.from('fc_documents').delete().eq('fc_id', fcId);
        await supabase.from('fc_profiles').update({
          status: 'allowance-consented',
          docs_deadline_at: null,
          docs_deadline_last_notified_at: null,
        }).eq('id', fcId);
        return json({ ok: true });
      }

      const currentTypes = (currentDocs ?? []).map((d) => d.doc_type);
      const toDelete = (currentDocs ?? [])
        .filter((d) => !types.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
        .map((d) => d.doc_type);
      const toAdd = types.filter((t) => !currentTypes.includes(t));

      if (toDelete.length) {
        await supabase.from('fc_documents').delete().eq('fc_id', fcId).in('doc_type', toDelete);
      }
      if (toAdd.length) {
        const rows = toAdd.map((t) => ({
          fc_id: fcId,
          doc_type: t,
          status: 'pending',
          file_name: '',
          storage_path: '',
        }));
        const { error: insertErr } = await supabase.from('fc_documents').insert(rows);
        if (insertErr) throw insertErr;
      }

      const profileUpdate: Record<string, string | null> = {
        docs_deadline_at: normalizedDeadline,
      };
      if (shouldResetNotify) profileUpdate.docs_deadline_last_notified_at = null;
      await supabase.from('fc_profiles').update({ status: 'docs-requested', ...profileUpdate }).eq('id', fcId);

      return json({ ok: true });
    }

    // ── updateDocStatus ──
    if (action === 'updateDocStatus') {
      const { fcId, docType, status, reviewerNote } = payload as {
        fcId: string;
        docType: string;
        status: string;
        reviewerNote?: string | null;
      };
      if (!fcId || !docType || !status) return fail('fcId, docType, and status are required');

      const updatePayload: Record<string, any> = { status };
      if (reviewerNote !== undefined) updatePayload.reviewer_note = reviewerNote;
      const { error } = await supabase
        .from('fc_documents')
        .update(updatePayload)
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (error) throw error;

      // Check if all docs approved → update profile status
      if (status === 'approved') {
        const { data: allDocs } = await supabase
          .from('fc_documents')
          .select('status,storage_path')
          .eq('fc_id', fcId);
        const allApproved = allDocs && allDocs.length > 0 &&
          allDocs.every((d) => d.status === 'approved') &&
          allDocs.every((d) => d.storage_path && d.storage_path !== 'deleted');
        if (allApproved) {
          await supabase.from('fc_profiles').update({ status: 'docs-approved' }).eq('id', fcId);
          return json({ ok: true, allApproved: true });
        }
      }
      return json({ ok: true, allApproved: false });
    }

    // ── deleteDocFile ──
    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as {
        fcId: string;
        docType: string;
        storagePath?: string | null;
      };
      if (!fcId || !docType) return fail('fcId and docType are required');

      if (storagePath) {
        const { error: storageErr } = await supabase.storage.from('fc-documents').remove([storagePath]);
        if (storageErr) throw storageErr;
      }
      const { error } = await supabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── upsertExamRound ──
    if (action === 'upsertExamRound') {
      const { roundId, data, locations } = payload as {
        roundId?: string | null;
        data: {
          exam_type: 'life' | 'nonlife';
          exam_date: string | null;
          registration_deadline: string;
          round_label?: string | null;
          notes?: string | null;
        };
        locations?: { location_name: string; sort_order?: number }[];
      };
      if (!data?.exam_type || !data?.registration_deadline) {
        return fail('exam_type and registration_deadline are required');
      }

      const rowPayload = {
        exam_type: data.exam_type,
        exam_date: data.exam_date ?? null,
        registration_deadline: data.registration_deadline,
        round_label: data.round_label ?? null,
        notes: data.notes ?? null,
      };

      let targetRoundId = roundId ?? null;
      if (targetRoundId) {
        const { error: updateErr } = await supabase
          .from('exam_rounds')
          .update(rowPayload)
          .eq('id', targetRoundId);
        if (updateErr) throw updateErr;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('exam_rounds')
          .insert(rowPayload)
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        targetRoundId = inserted.id;
      }

      const safeLocations = (locations ?? [])
        .map((loc) => ({
          location_name: (loc.location_name ?? '').trim(),
          sort_order: Number.isFinite(loc.sort_order as number) ? Number(loc.sort_order) : 0,
        }))
        .filter((loc) => Boolean(loc.location_name));

      if (safeLocations.length > 0 && targetRoundId) {
        const { data: currentLocs, error: currentErr } = await supabase
          .from('exam_locations')
          .select('location_name')
          .eq('round_id', targetRoundId);
        if (currentErr) throw currentErr;

        const existingNames = new Set((currentLocs ?? []).map((row) => row.location_name));
        const rowsToInsert = safeLocations
          .filter((loc) => !existingNames.has(loc.location_name))
          .map((loc) => ({
            round_id: targetRoundId,
            location_name: loc.location_name,
            sort_order: loc.sort_order,
          }));

        if (rowsToInsert.length > 0) {
          const { error: locInsertErr } = await supabase.from('exam_locations').insert(rowsToInsert);
          if (locInsertErr) throw locInsertErr;
        }
      }

      return json({ ok: true, roundId: targetRoundId });
    }

    // ── deleteExamRound ──
    if (action === 'deleteExamRound') {
      const { roundId } = payload as { roundId: string };
      if (!roundId) return fail('roundId is required');

      await supabase.from('exam_registrations').delete().eq('round_id', roundId);
      await supabase.from('exam_locations').delete().eq('round_id', roundId);

      const { error: deleteRoundErr } = await supabase
        .from('exam_rounds')
        .delete()
        .eq('id', roundId);
      if (deleteRoundErr) throw deleteRoundErr;

      return json({ ok: true });
    }

    // ── deleteFc ──
    if (action === 'deleteFc') {
      const { fcId, phone } = payload as { fcId: string; phone?: string | null };
      if (!fcId) return fail('fcId is required');

      let resolvedPhone = phone?.replace(/[^0-9]/g, '') || null;
      if (!resolvedPhone) {
        const { data: profile } = await supabase.from('fc_profiles').select('phone').eq('id', fcId).maybeSingle();
        resolvedPhone = profile?.phone || null;
      }

      const { data: docs } = await supabase.from('fc_documents').select('storage_path').eq('fc_id', fcId);
      const pathsToDelete = (docs ?? []).map((d: any) => d.storage_path).filter((p: string) => p && p !== 'deleted');
      if (pathsToDelete.length > 0) {
        await supabase.storage.from('fc-documents').remove(pathsToDelete);
      }

      await supabase.from('fc_documents').delete().eq('fc_id', fcId);
      if (resolvedPhone) {
        const maskedPhone = resolvedPhone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
        await supabase.from('messages').delete().or(`sender_id.eq.${resolvedPhone},receiver_id.eq.${resolvedPhone}`);
        await supabase.from('exam_registrations').delete().or(`resident_id.eq.${resolvedPhone},resident_id.eq.${maskedPhone}`);
        await supabase.from('notifications').delete().or(`resident_id.eq.${resolvedPhone},fc_id.eq.${fcId}`);
        await supabase.from('device_tokens').delete().eq('resident_id', resolvedPhone);
      }
      await supabase.from('fc_identity_secure').delete().eq('fc_id', fcId);
      const { error } = await supabase.from('fc_profiles').delete().eq('id', fcId);
      if (error) throw error;

      return json({ ok: true });
    }

    // ── sendNotification ──
    if (action === 'sendNotification') {
      const { phone, title, body: notifBody, role: recipientRole } = payload as {
        phone?: string;
        title: string;
        body: string;
        role?: string;
      };
      if (!title || !notifBody) return fail('title and body are required');

      await supabase.from('notifications').insert({
        title,
        body: notifBody,
        category: 'app_event',
        recipient_role: recipientRole ?? 'fc',
        resident_id: phone ?? null,
      });

      return json({ ok: true });
    }

    return fail('Unknown action');
  } catch (err: any) {
    return json({ ok: false, message: err?.message ?? 'Request failed' }, 500);
  }
});

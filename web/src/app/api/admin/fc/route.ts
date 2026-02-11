import dayjs from 'dayjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { sendPushNotification } from '@/app/actions';
import { adminSupabase } from '@/lib/admin-supabase';
import { validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';

type AdminAction =
  | 'updateProfile'
  | 'updateStatus'
  | 'updateDocsRequest'
  | 'deleteDocFile'
  | 'signDoc'
  | 'sendReminder';

type AdminRequest = {
  action: AdminAction;
  payload: Record<string, unknown>;
};

async function getAdminSession() {
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };
  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return { ok: false, status: 401, error: sessionCheck.error ?? 'Unauthorized' };
  }
  if (session.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, session };
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  const adminCheck = await getAdminSession();
  if (!adminCheck.ok) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status });
  }

  let body: AdminRequest;
  try {
    body = (await req.json()) as AdminRequest;
  } catch (err) {
    logger.error('[api/admin/fc] invalid json', err);
    return badRequest('Invalid JSON payload');
  }

  const { action, payload } = body ?? {};
  if (!action) return badRequest('action is required');

  try {
    if (action === 'updateProfile') {
      const { fcId, data, phone } = payload as {
        fcId?: string;
        data?: Record<string, unknown>;
        phone?: string;
      };
      if (!fcId || !data) return badRequest('fcId and data are required');

      const { error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update(data)
        .eq('id', fcId);
      if (updateError) throw updateError;

      const tempId = typeof data['temp_id'] === 'string' ? data['temp_id'] : null;
      const shouldNotifyTemp = Boolean(tempId);
      if (shouldNotifyTemp && phone) {
        const { data: profile } = await adminSupabase
          .from('fc_profiles')
          .select('name')
          .eq('id', fcId)
          .maybeSingle();
        const title = '임시번호 발급';
        const body = `임시사번: ${tempId} 이 발급되었습니다.`;
        await adminSupabase.from('notifications').insert({
          title,
          body,
          target_url: '/consent',
          recipient_role: 'fc',
          resident_id: phone,
        });
        await sendPushNotification(phone, { title, body, data: { url: '/consent' } });
        logger.debug('[api/admin/fc] temp-id notified', { fcId, name: profile?.name });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'updateStatus') {
      const { fcId, status, title, msg, extra, phone } = payload as {
        fcId?: string;
        status?: string;
        title?: string;
        msg?: string;
        extra?: Record<string, unknown>;
        phone?: string;
      };
      if (!fcId || !status) return badRequest('fcId and status are required');

      const { data: updatedData, error: updateError } = await adminSupabase
        .from('fc_profiles')
        .update({ status, ...(extra ?? {}) })
        .eq('id', fcId)
        .select();

      logger.debug('[api/admin/fc] updateStatus result', {
        fcId,
        status,
        updatedCount: updatedData?.length,
        updatedData,
        error: updateError
      });

      if (updateError) throw updateError;

      if (msg && phone) {
        const finalTitle = title || '상태 업데이트';
        let url = '/notifications';
        if (status === 'allowance-consented') url = '/docs-upload';
        else if (status === 'docs-approved') url = '/appointment';
        else if (status === 'temp-id-issued') url = '/consent';

        await adminSupabase.from('notifications').insert({
          title: finalTitle,
          body: msg,
          target_url: url,
          recipient_role: 'fc',
          resident_id: phone,
        });

        await sendPushNotification(phone, { title: finalTitle, body: msg, data: { url } });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'updateDocsRequest') {
      const { fcId, types, deadline, phone, currentDeadline } = payload as {
        fcId?: string;
        types?: string[];
        deadline?: string | null;
        currentDeadline?: string | null;
        phone?: string;
      };
      if (!fcId || !Array.isArray(types)) return badRequest('fcId and types are required');

      const nextTypes = types ?? [];
      const normalizedDeadline = deadline ? dayjs(deadline).format('YYYY-MM-DD') : null;
      const shouldResetNotify = normalizedDeadline !== (currentDeadline ?? null);

      const { data: currentDocsRaw, error: fetchErr } = await adminSupabase
        .from('fc_documents')
        .select('doc_type, storage_path')
        .eq('fc_id', fcId);
      if (fetchErr) throw fetchErr;

      const currentDocs = currentDocsRaw || [];
      const currentTypes = currentDocs.map((d) => d.doc_type);

      if (nextTypes.length === 0) {
        logger.info('[api/admin/fc] Deleting all documents', { fcId });
        const { error: deleteAllError, count: deleteAllCount } = await adminSupabase
          .from('fc_documents')
          .delete({ count: 'exact' })
          .eq('fc_id', fcId);
        if (deleteAllError) throw deleteAllError;
        logger.info('[api/admin/fc] Deleted all documents', { fcId, count: deleteAllCount });

        const { error: profileUpdateError } = await adminSupabase
          .from('fc_profiles')
          .update({
            status: 'allowance-consented',
            docs_deadline_at: null,
            docs_deadline_last_notified_at: null,
          })
          .eq('id', fcId);
        if (profileUpdateError) throw profileUpdateError;

        return NextResponse.json({ ok: true });
      }

      const toAdd = nextTypes.filter((type) => !currentTypes.includes(type));
      const toDelete = currentDocs
        .filter((d) => !nextTypes.includes(d.doc_type) && (!d.storage_path || d.storage_path === 'deleted'))
        .map((d) => d.doc_type);

      if (toDelete.length) {
        logger.info('[api/admin/fc] Deleting documents', { fcId, types: toDelete });
        const { error: deleteError, count: deleteCount } = await adminSupabase
          .from('fc_documents')
          .delete({ count: 'exact' })
          .eq('fc_id', fcId)
          .in('doc_type', toDelete);
        if (deleteError) throw deleteError;
        logger.info('[api/admin/fc] Deleted documents', { fcId, count: deleteCount, expected: toDelete.length });
      }
      if (toAdd.length) {
        const rows = toAdd.map((type) => ({
          fc_id: fcId,
          doc_type: type,
          status: 'pending' as const,
          file_name: '',
          storage_path: '',
        }));
        const { data: insertedDocs, error: insertError } = await adminSupabase
          .from('fc_documents')
          .insert(rows)
          .select();

        logger.debug('[api/admin/fc] updateDocsRequest insert result', {
          fcId,
          insertedCount: insertedDocs?.length,
          rowsToInsert: rows.length,
          error: insertError
        });

        if (insertError) throw insertError;
      }

      const profileUpdate: Record<string, string | null> = {
        docs_deadline_at: normalizedDeadline,
      };
      if (shouldResetNotify) {
        profileUpdate.docs_deadline_last_notified_at = null;
      }

      const { error: profileUpdateError } = await adminSupabase
        .from('fc_profiles')
        .update({ status: 'docs-requested', ...profileUpdate })
        .eq('id', fcId);
      if (profileUpdateError) throw profileUpdateError;

      if (phone) {
        const title = '필수 서류 등록 알림';
        const body = '관리자가 필수 서류 목록을 갱신하였습니다. 확인 후 제출해주세요.';
        await adminSupabase.from('notifications').insert({
          title,
          body,
          target_url: '/docs-upload',
          recipient_role: 'fc',
          resident_id: phone,
        });
        await sendPushNotification(phone, { title, body, data: { url: '/docs-upload' } });
      }

      return NextResponse.json({ ok: true });
    }

    if (action === 'deleteDocFile') {
      const { fcId, docType, storagePath } = payload as {
        fcId?: string;
        docType?: string;
        storagePath?: string;
      };
      if (!fcId || !docType || !storagePath) return badRequest('fcId, docType, storagePath are required');

      const { error: storageErr } = await adminSupabase.storage
        .from('fc-documents')
        .remove([storagePath]);
      if (storageErr) throw storageErr;

      const { error: updateErr } = await adminSupabase
        .from('fc_documents')
        .update({ storage_path: 'deleted', file_name: 'deleted.pdf', status: 'pending', reviewer_note: null })
        .eq('fc_id', fcId)
        .eq('doc_type', docType);
      if (updateErr) throw updateErr;

      return NextResponse.json({ ok: true });
    }

    if (action === 'signDoc') {
      const { path } = payload as { path?: string };
      if (!path) return badRequest('path is required');
      const { data, error } = await adminSupabase.storage
        .from('fc-documents')
        .createSignedUrl(path, 60);
      if (error || !data?.signedUrl) {
        throw error ?? new Error('Signed URL creation failed');
      }
      return NextResponse.json({ ok: true, signedUrl: data.signedUrl });
    }

    if (action === 'sendReminder') {
      const { phone, title, body, url } = payload as {
        phone?: string;
        title?: string;
        body?: string;
        url?: string;
      };
      if (!phone || !title || !body) return badRequest('phone, title, body are required');

      await adminSupabase.from('notifications').insert({
        title,
        body,
        target_url: url ?? '/notifications',
        recipient_role: 'fc',
        resident_id: phone,
      });

      await sendPushNotification(phone, { title, body, data: url ? { url } : undefined });
      return NextResponse.json({ ok: true });
    }

    return badRequest('Unknown action');
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/fc] failed', error);
    return NextResponse.json({ error: error?.message ?? 'Request failed' }, { status: 500 });
  }
}

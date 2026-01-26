import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { checkRateLimit, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
}

const adminClient = createClient(supabaseUrl, serviceKey);

type DeleteRequestBody = {
  fcId?: string;
};

export async function POST(req: Request) {
  let body: DeleteRequestBody;
  try {
    body = (await req.json()) as DeleteRequestBody;
  } catch (err) {
    logger.error('[api/fc-delete] Invalid JSON payload', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const cookieStore = cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const sessionCheck = validateSession(session);
  if (!sessionCheck.valid) {
    return NextResponse.json({ error: sessionCheck.error ?? 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = checkRateLimit(`fc-delete:${session.residentId}`, 10, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const fcId = body.fcId?.trim();
  if (!fcId) {
    return NextResponse.json({ error: 'fcId is required' }, { status: 400 });
  }

  const { data: profile, error: profileError } = await adminClient
    .from('fc_profiles')
    .select('id')
    .eq('id', fcId)
    .maybeSingle();

  if (profileError) {
    logger.error('[api/fc-delete] profile lookup failed', profileError);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile?.id) {
    return NextResponse.json({ ok: true, deleted: false }, { status: 200 });
  }

  const { data: docs, error: docsError } = await adminClient
    .from('fc_documents')
    .select('storage_path')
    .eq('fc_id', fcId);

  if (docsError) {
    logger.error('[api/fc-delete] fc_documents select failed', docsError);
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  const storagePaths = (docs ?? [])
    .map((doc) => doc.storage_path)
    .filter((path): path is string => Boolean(path));

  if (storagePaths.length > 0) {
    const { error: storageError } = await adminClient.storage
      .from('fc-documents')
      .remove(storagePaths);

    if (storageError) {
      logger.warn('[api/fc-delete] storage remove failed', storageError);
    }
  }

  const { error: docsDeleteError } = await adminClient
    .from('fc_documents')
    .delete()
    .eq('fc_id', fcId);

  if (docsDeleteError) {
    logger.error('[api/fc-delete] fc_documents delete failed', docsDeleteError);
    return NextResponse.json({ error: docsDeleteError.message }, { status: 500 });
  }

  const { error: profileDeleteError } = await adminClient
    .from('fc_profiles')
    .delete()
    .eq('id', fcId);

  if (profileDeleteError) {
    logger.error('[api/fc-delete] fc_profiles delete failed', profileDeleteError);
    return NextResponse.json({ error: profileDeleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}

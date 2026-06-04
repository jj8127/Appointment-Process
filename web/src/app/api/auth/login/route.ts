import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  createFcGraphSessionValue,
  FC_GRAPH_SESSION_COOKIE,
  FC_GRAPH_SESSION_MAX_AGE_SECONDS,
} from '@/lib/fc-graph-session';
import { adminSupabase } from '@/lib/admin-supabase';
import { buildPhoneCandidates } from '@/lib/phone-candidates';
import { logger } from '@/lib/logger';

type LoginResponse = {
  ok?: boolean;
  role?: 'admin' | 'manager' | 'fc';
  residentId?: string;
  displayName?: string;
  staffType?: string | null;
  fcId?: string;
  code?: string;
  message?: string;
};

function normalizeDigits(value: unknown) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function createSupabaseFunctionClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase web auth env is not configured.');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: Request) {
  let body: { phone?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '잘못된 로그인 요청입니다.' }, { status: 400 });
  }

  const phone = normalizeDigits(body.phone);
  const password = String(body.password ?? '').trim();
  if (phone.length !== 11 || !password) {
    return NextResponse.json({ ok: false, message: '휴대폰 번호와 비밀번호를 확인해주세요.' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseFunctionClient();
    const { data, error } = await supabase.functions.invoke<LoginResponse>('login-with-password', {
      body: { phone, password },
    });

    if (error) {
      throw error;
    }

    const response = NextResponse.json(data ?? { ok: false, message: '로그인 결과를 확인할 수 없습니다.' });

    if (data?.ok && data.role === 'fc') {
      const residentDigits = normalizeDigits(data.residentId ?? phone);
      const { data: profileRow, error: profileError } = await adminSupabase
        .from('fc_profiles')
        .select('id')
        .in('phone', buildPhoneCandidates(data.residentId ?? phone, residentDigits))
        .maybeSingle();

      if (profileError || !profileRow?.id) {
        logger.warn('[api/auth/login] FC profile not found after password login', {
          phone: residentDigits,
          error: profileError?.message,
        });
        return NextResponse.json(
          { ok: false, message: 'FC 계정 정보를 확인할 수 없습니다.' },
          { status: 403 },
        );
      }

      const sessionValue = createFcGraphSessionValue({
        fcId: profileRow.id,
        residentDigits,
      });

      response.cookies.set(FC_GRAPH_SESSION_COOKIE, sessionValue, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: FC_GRAPH_SESSION_MAX_AGE_SECONDS,
      });
    } else {
      response.cookies.set(FC_GRAPH_SESSION_COOKIE, '', {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    logger.error('[api/auth/login] failed', error);
    return NextResponse.json(
      { ok: false, message: '로그인 요청을 처리하지 못했습니다.' },
      { status: 500 },
    );
  }
}

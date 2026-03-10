import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * 서버 에러를 로그에 기록하고, 클라이언트에는 일반화된 메시지만 반환.
 * 내부 에러 상세(DB 구조, 스택 트레이스 등)가 외부에 노출되지 않도록 함.
 */
export function serverError(err: unknown, label: string): NextResponse {
  logger.error(`[${label}] internal error`, err);
  return NextResponse.json(
    { error: '요청 처리에 실패했습니다.' },
    { status: 500 },
  );
}

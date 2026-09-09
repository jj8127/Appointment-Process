import writeExcelFile from 'write-excel-file/node';
import { NextResponse } from 'next/server';

import { requireAdminRoute } from '@/lib/admin-route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: '관리자 로그인이 필요합니다.' }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
  const headers = ['사번', '직속상위사번', '이름', '소속', '업적기준재적', '기준일재적', '기준일직급', '최종대상업적'];
  const bytes = await writeExcelFile([
    { sheet: '산정정보', columns: [{ width: 24 }, { width: 85 }], data: [
      ['항목', '입력값'], ['업적월', ''], ['실제지급일', ''], ['계보기준일', ''],
      ['인사원본기준일', ''], ['원본기준일목록', ''],
      ['원본 기준일 입력', '사용한 계보·인사 원본의 실제 날짜를 YYYY-MM-DD 형식으로 쉼표로 구분합니다. 시범 기준일로 바꾸어 적지 않습니다.'],
      ['날짜 입력', '업적월은 YYYY-MM, 실제지급일·계보기준일은 YYYY-MM-DD 텍스트로 입력합니다.'],
      ['사번 입력', '사번과 직속상위사번은 텍스트로 입력합니다. 이름으로 연결하지 않습니다.'],
      ['재적 입력', '업적기준재적·기준일재적에는 재적 또는 해촉을 입력합니다. 미확인 상태를 해촉으로 바꾸지 않습니다.'],
      ['직급 입력', '기준일 직급을 그대로 입력합니다. 지급 대상 직급은 FP입니다.'],
      ['대상업적 입력', '검토된 최종 대상업적을 숫자로 입력합니다. 원천 보험료나 이미 절사한 수당을 넣지 않습니다.'],
      ['계보 입력', '같은 업로드한 계보 기준의 전체 부모 관계를 입력합니다. 최상위의 직속상위사번만 비워둡니다.'],
      ['산정 범위', '당월 신규 산정만 포함합니다. 전월 이월금·본부지원금·별도 시상은 포함하지 않습니다.'],
    ] },
    { sheet: '월별 산정자료', columns: headers.map((_, index) => ({ width: index === 7 ? 24 : 20 })), stickyRowsCount: 1,
      data: [headers.map((value) => ({ type: String, value, fontWeight: 'bold' as const, backgroundColor: '#fff7ed' }))] },
  ]).toBuffer();
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="referral-allowance-template.xlsx"', 'Cache-Control': 'no-store, private',
  } });
}

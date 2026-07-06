import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('admin web appointment approval clarity', () => {
  const dashboardSource = () => readFileSync(
    join(process.cwd(), 'web', 'src', 'app', 'dashboard', 'page.tsx'),
    'utf8',
  );

  it('separates final commission completion from appointment approval state', () => {
    const source = dashboardSource();

    expect(source).toContain('최종 완료 상태');
    expect(source).toContain('승인 후 최종 완료 여부를 별도로 저장합니다.');
    expect(source).toContain('생명 최종 완료');
    expect(source).toContain('손해 최종 완료');
    expect(source).toContain('최종 완료 상태 저장');

    expect(source).toContain('승인 상태:');
    expect(source).toContain('FC 제출, 승인 대기');
    expect(source).toContain('승인 처리');
    expect(source).toContain('승인 완료됨');
    expect(source).toContain('disabled={isConfirmed || isReadOnly || appointmentBusy || !date || !insuranceStageOpen}');
  });
});

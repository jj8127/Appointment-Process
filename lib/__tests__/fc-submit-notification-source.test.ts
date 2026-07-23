import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

describe('FC submit notification source', () => {
  it.each([
    'appointment.tsx',
    'consent.tsx',
    'hanwha-commission.tsx',
  ])('%s awaits notification delivery without exposing a post-commit warning', (fileName) => {
    const source = readFileSync(join(root, 'app', fileName), 'utf8');

    expect(source).toContain('await invokeFcNotifyForDelivery({');
    expect(source).not.toContain('알림 확인 필요');
    expect(source).not.toContain('정보는 정상 저장됐지만 담당자 알림 전달을 확인하지 못했습니다.');
    expect(source).not.toContain('.catch(() => undefined)');
    expect(source).not.toContain('.catch(() => { });');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('appointment submit success feedback', () => {
  const source = () => readFileSync(join(process.cwd(), 'app/appointment.tsx'), 'utf8');

  it('uses in-app toast feedback instead of a native success alert after appointment submit refresh', () => {
    const appointmentSource = source();

    expect(appointmentSource).toContain("import { useToast } from '@/components/Toast';");
    expect(appointmentSource).not.toMatch(/Alert\.alert\(\s*['"]제출 완료['"]/);
    expect(appointmentSource).toMatch(/await load\(\);\s*showToast\(\{[\s\S]*variant: 'success'/);
  });
});

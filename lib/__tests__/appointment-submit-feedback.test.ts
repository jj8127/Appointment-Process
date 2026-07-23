import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('appointment submit success feedback', () => {
  const source = () => readFileSync(join(process.cwd(), 'app/appointment.tsx'), 'utf8');

  it('shows business success while keeping delivery diagnostics out of the UI', () => {
    const appointmentSource = source();

    expect(appointmentSource).toContain("import { useToast } from '@/components/Toast';");
    expect(appointmentSource).toMatch(
      /await load\(\);\s*showToast\(\{[\s\S]{0,400}variant: 'success'/,
    );
    expect(appointmentSource).not.toContain('notificationDelivery.confirmed');
    expect(appointmentSource).not.toContain('알림 확인 필요');
  });
});

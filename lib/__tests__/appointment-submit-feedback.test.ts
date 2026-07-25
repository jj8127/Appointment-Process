import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('appointment submit success feedback', () => {
  const source = () => readFileSync(join(process.cwd(), 'app/appointment.tsx'), 'utf8');

  it('shows business success and only retries notification registration', () => {
    const appointmentSource = source();

    expect(appointmentSource).toContain(
      "import { presentPostCommitNotificationDelivery } from '@/lib/fc-notify-post-commit';",
    );
    expect(appointmentSource).toMatch(
      /const notificationDelivery = await notifyAdmins\(\);[\s\S]{0,180}await load\(\);[\s\S]{0,180}presentPostCommitNotificationDelivery\(\{/,
    );
    expect(appointmentSource).toContain('retryNotification: notifyAdmins');
    expect(appointmentSource).not.toContain('알림 확인 필요');
  });
});

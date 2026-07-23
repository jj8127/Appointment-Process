import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('appointment submit success feedback', () => {
  const source = () => readFileSync(join(process.cwd(), 'app/appointment.tsx'), 'utf8');

  it('separates confirmed delivery feedback from a post-commit delivery warning', () => {
    const appointmentSource = source();

    expect(appointmentSource).toContain("import { useToast } from '@/components/Toast';");
    expect(appointmentSource).toMatch(
      /await load\(\);\s*if \(notificationDelivery\.confirmed\) \{\s*showToast\(\{[\s\S]{0,400}variant: 'success'/,
    );
    expect(appointmentSource).toMatch(
      /\} else \{\s*Alert\.alert\([\s\S]{0,400}\);\s*\}/,
    );
  });
});

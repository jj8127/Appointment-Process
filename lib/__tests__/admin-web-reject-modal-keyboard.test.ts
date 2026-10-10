import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keyboard behavior is exercised by the policy table and actual modal callback.
// This contract only checks that all three workflow screens use that shared modal.
describe('admin web reject modal wiring', () => {
  it('uses the shared reject modal for dashboard, appointment and documents', () => {
    for (const path of ['web/src/app/dashboard/page.tsx', 'web/src/app/dashboard/appointment/page.tsx', 'web/src/app/dashboard/docs/page.tsx']) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source).toContain("import { RejectReasonModal } from '@/components/RejectReasonModal';");
      expect(source).toContain('<RejectReasonModal');
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const rejectReasonModalPath = join(root, 'web', 'src', 'components', 'RejectReasonModal.tsx');
const dashboardPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'page.tsx');
const appointmentPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'appointment', 'page.tsx');
const docsPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'docs', 'page.tsx');

describe('admin web reject modal keyboard submit', () => {
  it('centralizes reject reason input and owns Enter versus Shift+Enter behavior', () => {
    const modalSource = readFileSync(rejectReasonModalPath, 'utf8');
    const dashboardPage = readFileSync(dashboardPagePath, 'utf8');
    const appointmentPage = readFileSync(appointmentPagePath, 'utf8');
    const docsPage = readFileSync(docsPagePath, 'utf8');

    expect(modalSource).toContain("event.key !== 'Enter'");
    expect(modalSource).toContain('event.shiftKey');
    expect(modalSource).toContain('event.preventDefault();');
    expect(modalSource).toContain('void onSubmit();');
    expect(modalSource).toContain('onKeyDown={handleReasonKeyDown}');

    for (const source of [dashboardPage, appointmentPage, docsPage]) {
      expect(source).toContain("import { RejectReasonModal } from '@/components/RejectReasonModal';");
      expect(source).toContain('<RejectReasonModal');
    }

    expect(dashboardPage).not.toContain("title={\n          <Text fw={700}>\n            {rejectTarget?.kind === 'allowance'");
    expect(appointmentPage).not.toContain('<Textarea\n              label="반려 사유"');
    expect(docsPage).not.toContain('푸시 알림으로 전송됩니다.\n                    </Text>\n                    <Textarea');
  });
});

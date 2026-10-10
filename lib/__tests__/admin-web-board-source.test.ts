import { readFileSync } from 'node:fs';

// Attachment deletion and capacity are exercised with the actual callbacks in
// web/src/lib/ux-priority-one-runtime.test.mjs. This checks the shared API boundary.
describe('admin web board composer wiring', () => {
  it('uses the board API to delete stored attachments', () => {
    const page = readFileSync('web/src/app/dashboard/board/page.tsx', 'utf8');
    expect(page).toContain('deleteBoardAttachments');
    expect(page).not.toMatch(/supabase[\s\S]{0,100}\.from\(\s*['"]board_attachments['"]/);
  });
});

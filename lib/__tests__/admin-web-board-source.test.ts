import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const boardPagePath = join(root, 'web', 'src', 'app', 'dashboard', 'board', 'page.tsx');

describe('admin web board composer source', () => {
  it('lets editors remove existing board attachments before saving a post', () => {
    const page = readFileSync(boardPagePath, 'utf8');

    expect(page).toContain('deleteBoardAttachments');
    expect(page).toContain('const removeExistingAttachment =');
    expect(page).toContain('await deleteBoardAttachments(actor, editingPostId, [file.id])');
    expect(page).toContain('setExistingAttachments((prev) => prev.filter((item) => item.id !== file.id))');
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['board-detail', editingPostId] })");
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['board-posts'] })");
  });

  it('keeps the existing attachment count in sync after an existing attachment is deleted', () => {
    const page = readFileSync(boardPagePath, 'utf8');

    expect(page).toContain('const existingAttachmentCount = existingAttachments.length');
    expect(page).toContain('const total = existingAttachmentCount + attachments.length + nextItems.length');
    expect(page).toContain('nextItems.splice(MAX_ATTACHMENTS - existingAttachmentCount - attachments.length)');
  });
});

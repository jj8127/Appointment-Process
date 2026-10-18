const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'admin-action', 'index.ts'),
  'utf8',
);

describe('admin-action appointment update contract', () => {
  const actionStart = source.indexOf("if (action === 'updateAppointmentDate')");
  const actionEnd = source.indexOf("if (action === 'updateAppointmentSchedule')", actionStart);
  const actionSource = source.slice(actionStart, actionEnd);

  it('commits the confirmed date, rejection state, submission reset, and workflow status together', () => {
    expect(actionSource).toContain('const confirmedDate = isReject ? null : date;');
    expect(actionSource).toContain('[field]: confirmedDate');
    expect(actionSource).toContain('[rejectField]: isReject ? rejectReason ?? null : null');
    expect(actionSource).toContain('if (isReject) updatePayload[submittedField] = null;');
    expect(actionSource).toContain('status: nextStatus');
    expect(actionSource.match(/\.update\(/g)).toHaveLength(1);
    expect(actionSource).toContain('requireMutationRowReceipt(updated, { ...updatePayload, id: fcId });');
  });

  it('fails closed instead of returning a warning success after a separate status write', () => {
    expect(actionSource).not.toContain('workflow_update_incomplete');
    expect(actionSource).not.toContain('statusReceipt');
    expect(actionSource).not.toContain('statusErr');
    expect(actionSource).toContain('return json({ ok: true, status: nextStatus });');
  });
});

describe('admin-action account deletion storage ownership boundary', () => {
  const actionStart = source.indexOf("if (action === 'deleteFc')");
  const actionEnd = source.indexOf("if (action === 'sendNotification')", actionStart);
  const actionSource = source.slice(actionStart, actionEnd);

  it('never deletes unowned legacy chat upload URLs with the service role', () => {
    expect(source).not.toContain('function extractChatUploadPath');
    expect(actionSource).not.toContain('result.chat_file_urls');
    expect(actionSource).not.toContain("storage.from('chat-uploads').remove");
    expect(actionSource).toContain("storage.from('exam-payment-proofs').remove");
    expect(actionSource).toContain("storage.from('fc-documents').remove");
    expect(actionSource).toContain("storage.from('board-attachments').remove");
    expect(actionSource).toContain('drainMessengerAttachmentCleanup');
  });
});

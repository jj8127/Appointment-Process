export type MessengerAttachmentCommit = {
  batchId: string;
  replayed: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMessengerAttachmentCommit(value: unknown): MessengerAttachmentCommit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const commit = value as Record<string, unknown>;
  if (!UUID_PATTERN.test(String(commit.batchId ?? '')) || typeof commit.replayed !== 'boolean') {
    return null;
  }
  return {
    batchId: String(commit.batchId).toLowerCase(),
    replayed: commit.replayed,
  };
}

export function validateMessengerAttachmentCommitResponse(input: {
  attachmentCommit: unknown;
  message: {
    message_type?: unknown;
    attachments?: unknown;
  } | null | undefined;
  expectedAttachmentCount: number;
}): MessengerAttachmentCommit | null {
  if (!Number.isSafeInteger(input.expectedAttachmentCount) || input.expectedAttachmentCount < 1) {
    return null;
  }
  const attachmentCommit = parseMessengerAttachmentCommit(input.attachmentCommit);
  if (
    !attachmentCommit
    || input.message?.message_type !== 'file'
    || !Array.isArray(input.message.attachments)
    || input.message.attachments.length !== input.expectedAttachmentCount
  ) {
    return null;
  }
  return attachmentCommit;
}

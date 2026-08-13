import {
  deliverCreatedRequestAttachments,
  type PendingRequestAttachmentDelivery,
  type RequestAttachmentDeliveryDeps,
} from '../request-board-attachment-delivery';

const files = [
  {
    uri: 'file:///safe-document.pdf',
    name: 'document.pdf',
    type: 'application/pdf',
  },
];
const uploaded = [
  {
    fileName: 'document.pdf',
    fileType: 'application/pdf',
    fileSize: 12,
    fileUrl: '/safe/document.pdf',
  },
];

const initialPending: PendingRequestAttachmentDelivery = {
  requestIds: [101, 102],
  assignmentIds: [],
  uploadedAttachments: null,
  deliveryBatchKey: 'garamin_attachment:00000000-0000-4000-8000-000000000000',
};

const createDeps = (
  overrides: Partial<RequestAttachmentDeliveryDeps> = {},
): RequestAttachmentDeliveryDeps => ({
  uploadAttachments: jest.fn(async () => ({ success: true, data: uploaded })),
  getRequestDetail: jest.fn(async (requestId) => ({
    id: requestId,
    status: 'pending',
    customer_name: 'masked',
    created_at: '2026-07-23T00:00:00.000Z',
    request_designers: [
      {
        id: requestId + 1000,
        designer_id: 1,
        status: 'pending',
        fc_decision: 'pending' as const,
      },
    ],
  })),
  sendMessage: jest.fn(async () => ({ success: true })),
  ...overrides,
});

describe('request board post-commit attachment delivery', () => {
  it('keeps created request ids when attachment upload is not confirmed', async () => {
    const sendMessage = jest.fn(async () => ({ success: true }));
    const result = await deliverCreatedRequestAttachments(initialPending, files, createDeps({
      uploadAttachments: async () => ({ success: false, error: 'provider detail' }),
      sendMessage,
    }));

    expect(result).toEqual({
      complete: false,
      pending: initialPending,
      unresolvedRequestCount: 2,
      unresolvedAssignmentCount: 0,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('tracks only unresolved request and assignment ids after partial delivery', async () => {
    const result = await deliverCreatedRequestAttachments(initialPending, files, createDeps({
      getRequestDetail: jest.fn(async (requestId) => {
        if (requestId === 102) return null;
        return {
          id: requestId,
          status: 'pending',
          customer_name: 'masked',
          created_at: '2026-07-23T00:00:00.000Z',
          request_designers: [
            {
              id: 1101,
              designer_id: 1,
              status: 'pending',
              fc_decision: 'pending' as const,
            },
          ],
        };
      }),
      sendMessage: async () => ({ success: false, error: 'delivery unconfirmed' }),
    }));

    expect(result.complete).toBe(false);
    expect(result.pending).toEqual({
      requestIds: [102],
      assignmentIds: [1101],
      uploadedAttachments: uploaded,
      deliveryBatchKey: initialPending.deliveryBatchKey,
    });
  });

  it('retries only saved request and assignment delivery without uploading again', async () => {
    const uploadAttachments = jest.fn(async () => ({ success: true, data: uploaded }));
    const sendMessage = jest.fn(async (
      _assignmentId: number,
      _message: string,
      _attachments: typeof uploaded,
      _deliveryKey: string,
    ) => ({ success: true }));
    const pending: PendingRequestAttachmentDelivery = {
      requestIds: [102],
      assignmentIds: [1101],
      uploadedAttachments: uploaded,
      deliveryBatchKey: initialPending.deliveryBatchKey,
    };

    const result = await deliverCreatedRequestAttachments(pending, files, createDeps({
      uploadAttachments,
      getRequestDetail: async () => ({
        id: 102,
        status: 'pending',
        customer_name: 'masked',
        created_at: '2026-07-23T00:00:00.000Z',
        request_designers: [
          {
            id: 1102,
            designer_id: 2,
            status: 'pending',
            fc_decision: 'pending' as const,
          },
        ],
      }),
      sendMessage,
    }));

    expect(result.complete).toBe(true);
    expect(result.pending).toBeNull();
    expect(uploadAttachments).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([assignmentId]) => assignmentId)).toEqual([1101, 1102]);
    expect(sendMessage.mock.calls.map((call) => call[3])).toEqual([
      `${initialPending.deliveryBatchKey}:1101`,
      `${initialPending.deliveryBatchKey}:1102`,
    ]);
  });
});

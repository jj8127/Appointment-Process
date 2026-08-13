import type {
  RbAttachmentMeta,
  RbRequestDetail,
  RbRequestUploadFile,
} from './request-board-api';

export type PendingRequestAttachmentDelivery = {
  requestIds: number[];
  assignmentIds: number[];
  uploadedAttachments: RbAttachmentMeta[] | null;
  deliveryBatchKey: string;
};

export type RequestAttachmentDeliveryResult = {
  complete: boolean;
  pending: PendingRequestAttachmentDelivery | null;
  unresolvedRequestCount: number;
  unresolvedAssignmentCount: number;
};

type AttachmentUploadResult = {
  success: boolean;
  data?: RbAttachmentMeta[];
  error?: string;
};

type MessageDeliveryResult = {
  success: boolean;
  error?: string;
};

export type RequestAttachmentDeliveryDeps = {
  uploadAttachments: (files: RbRequestUploadFile[]) => Promise<AttachmentUploadResult>;
  getRequestDetail: (requestId: number) => Promise<RbRequestDetail | null>;
  sendMessage: (
    assignmentId: number,
    message: string,
    attachments: RbAttachmentMeta[],
    deliveryKey: string,
  ) => Promise<MessageDeliveryResult>;
};

const uniqueIds = (ids: number[]) => Array.from(new Set(ids));

export async function deliverCreatedRequestAttachments(
  pending: PendingRequestAttachmentDelivery,
  files: RbRequestUploadFile[],
  deps: RequestAttachmentDeliveryDeps,
): Promise<RequestAttachmentDeliveryResult> {
  let uploadedAttachments = pending.uploadedAttachments;

  if (!uploadedAttachments) {
    try {
      const uploadResult = await deps.uploadAttachments(files);
      if (!uploadResult.success || !uploadResult.data?.length) {
        return {
          complete: false,
          pending,
          unresolvedRequestCount: pending.requestIds.length,
          unresolvedAssignmentCount: pending.assignmentIds.length,
        };
      }
      uploadedAttachments = uploadResult.data;
    } catch {
      return {
        complete: false,
        pending,
        unresolvedRequestCount: pending.requestIds.length,
        unresolvedAssignmentCount: pending.assignmentIds.length,
      };
    }
  }

  const detailResults = await Promise.allSettled(
    pending.requestIds.map(async (requestId) => {
      const detail = await deps.getRequestDetail(requestId);
      if (!detail?.request_designers?.length) {
        throw new Error('assignment_lookup_incomplete');
      }
      return detail.request_designers.map((assignment) => assignment.id);
    }),
  );

  const unresolvedRequestIds: number[] = [];
  const discoveredAssignmentIds: number[] = [];
  detailResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      discoveredAssignmentIds.push(...result.value);
      return;
    }
    unresolvedRequestIds.push(pending.requestIds[index]);
  });

  const assignmentIds = uniqueIds([
    ...pending.assignmentIds,
    ...discoveredAssignmentIds,
  ]);
  const messageResults = await Promise.allSettled(
    assignmentIds.map((assignmentId) =>
      deps.sendMessage(
        assignmentId,
        '설계 요청 첨부파일을 전달드립니다.',
        uploadedAttachments,
        `${pending.deliveryBatchKey}:${assignmentId}`,
      ),
    ),
  );
  const unresolvedAssignmentIds = messageResults.flatMap((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      return [];
    }
    return [assignmentIds[index]];
  });

  if (unresolvedRequestIds.length === 0 && unresolvedAssignmentIds.length === 0) {
    return {
      complete: true,
      pending: null,
      unresolvedRequestCount: 0,
      unresolvedAssignmentCount: 0,
    };
  }

  return {
    complete: false,
    pending: {
      requestIds: unresolvedRequestIds,
      assignmentIds: unresolvedAssignmentIds,
      uploadedAttachments,
      deliveryBatchKey: pending.deliveryBatchKey,
    },
    unresolvedRequestCount: unresolvedRequestIds.length,
    unresolvedAssignmentCount: unresolvedAssignmentIds.length,
  };
}

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { ExamFlowType } from '@/lib/exam-flow-contract';
import type { ExamPaymentProofSelection } from '@/lib/exam-payment-proof';
import { supabase } from '@/lib/supabase';

type FunctionEnvelope<T> = {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: T;
};

type PrepareResult = {
  uploadId: string;
  signedUrl?: string;
  alreadyAttached: boolean;
};

type SubmitResult = {
  registrationId: string | null;
  proofAttached: boolean;
  cleanupWarning: boolean;
};

type ViewResult = {
  signedUrl: string;
  expiresInSeconds: number;
};

export type ExamApplicationTarget = {
  fcId: string;
  residentId: string;
  name: string;
  affiliation: string;
  phoneLast4: string;
};

const RELOGIN_ERROR_CODES = new Set([
  'missing_app_session',
  'expired_app_session',
  'invalid_app_session',
  'invalid_session',
  'actor_not_found',
]);

export class ExamPaymentProofApiError extends Error {
  readonly code?: string;
  readonly needsRelogin: boolean;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ExamPaymentProofApiError';
    this.code = code;
    this.needsRelogin = Boolean(code && RELOGIN_ERROR_CODES.has(code));
  }
}

type FunctionFailure = Pick<FunctionEnvelope<unknown>, 'code' | 'message'>;

function normalizeFunctionFailure(payload: FunctionFailure | null | undefined): FunctionFailure {
  return {
    code: typeof payload?.code === 'string' && payload.code.trim()
      ? payload.code.trim()
      : undefined,
    message: typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : undefined,
  };
}

async function getFunctionErrorFailure(error: unknown): Promise<FunctionFailure | null> {
  if (!error || typeof error !== 'object') return null;
  const context = (error as {
    context?: {
      bodyUsed?: boolean;
      json?: () => Promise<unknown>;
    };
  }).context;
  if (!context || context.bodyUsed || typeof context.json !== 'function') {
    return null;
  }

  try {
    const payload = await context.json() as FunctionEnvelope<unknown> | null;
    return normalizeFunctionFailure(payload);
  } catch {
    return null;
  }
}

async function invokeExamPaymentProof<T>(
  appSessionToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = appSessionToken.trim();
  if (!token) {
    throw new ExamPaymentProofApiError(
      '시험 신청을 계속하려면 다시 로그인해주세요.',
      'missing_app_session',
    );
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    'exam-payment-proof',
    {
      body,
      headers: {
        'x-app-session-token': token,
      },
    },
  );

  if (error || !data?.ok || !data.data) {
    const dataFailure = normalizeFunctionFailure(data);
    const httpFailure = await getFunctionErrorFailure(error);
    throw new ExamPaymentProofApiError(
      dataFailure.message ?? httpFailure?.message ?? '시험 신청 서버에 연결하지 못했습니다.',
      dataFailure.code ?? httpFailure?.code,
    );
  }
  return data.data;
}

export function prepareExamPaymentProofUpload(
  appSessionToken: string,
  proof: ExamPaymentProofSelection,
  targetFcId?: string | null,
) {
  return invokeExamPaymentProof<PrepareResult>(appSessionToken, {
    action: 'prepare',
    requestId: proof.requestId,
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    fileSize: proof.fileSize,
    targetFcId: targetFcId ?? null,
  });
}

export async function listExamApplicationTargets(appSessionToken: string) {
  const result = await invokeExamPaymentProof<{ targets: ExamApplicationTarget[] }>(
    appSessionToken,
    { action: 'list_targets' },
  );
  if (!Array.isArray(result.targets) || !result.targets.every((target) => (
    target !== null
    && typeof target === 'object'
    && typeof target.fcId === 'string'
    && typeof target.residentId === 'string'
    && typeof target.name === 'string'
    && typeof target.affiliation === 'string'
    && typeof target.phoneLast4 === 'string'
  ))) {
    throw new ExamPaymentProofApiError(
      'FC 목록을 불러오지 못했습니다. 다시 시도해주세요.',
      'invalid_response',
    );
  }
  return result.targets;
}

export async function uploadExamPaymentProof(
  signedUrl: string,
  proof: ExamPaymentProofSelection,
) {
  if (Platform.OS === 'web') {
    const response = await fetch(proof.uri);
    if (!response.ok) {
      throw new Error('선택한 사진을 읽지 못했습니다.');
    }
    const fileBody = new Uint8Array(await (await response.blob()).arrayBuffer());
    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': proof.mimeType },
      body: fileBody,
    });
    if (!uploadResponse.ok) {
      throw new Error('입금 내역 사진 업로드에 실패했습니다.');
    }
    return;
  }

  const result = await FileSystem.uploadAsync(signedUrl, proof.uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': proof.mimeType },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error('입금 내역 사진 업로드에 실패했습니다.');
  }
}

export function submitExamApplicationWithPaymentProof({
  appSessionToken,
  uploadId,
  roundId,
  locationId,
  examType,
  targetFcId,
  includesPrimaryExam,
  isThirdExam,
}: {
  appSessionToken: string;
  uploadId: string | null;
  roundId: string;
  locationId: string;
  examType: ExamFlowType;
  targetFcId?: string | null;
  includesPrimaryExam: boolean;
  isThirdExam: boolean;
}) {
  return invokeExamPaymentProof<SubmitResult>(appSessionToken, {
    action: 'submit_v3',
    uploadId,
    roundId,
    locationId,
    examType,
    targetFcId: targetFcId ?? null,
    includesPrimaryExam,
    isThirdExam,
  });
}

export async function discardExamPaymentProofUpload(
  appSessionToken: string,
  uploadId: string,
  targetFcId?: string | null,
) {
  const token = appSessionToken.trim();
  if (!token || !uploadId.trim()) return;

  await supabase.functions.invoke('exam-payment-proof', {
    body: {
      action: 'discard',
      uploadId,
      targetFcId: targetFcId ?? null,
    },
    headers: {
      'x-app-session-token': token,
    },
  });
}

export function cancelExamApplicationWithPaymentProof(
  appSessionToken: string,
  registrationId: string,
) {
  return invokeExamPaymentProof<{ cleanupWarning: boolean }>(appSessionToken, {
    action: 'cancel',
    registrationId,
  });
}

export function getExamPaymentProofViewUrl(
  appSessionToken: string,
  registrationId: string,
  targetFcId?: string | null,
) {
  return invokeExamPaymentProof<ViewResult>(appSessionToken, {
    action: 'view',
    registrationId,
    targetFcId: targetFcId ?? null,
  });
}

import { z } from 'zod';

import { CARE_DECISIONS, decisionNeedsNote } from '@shared/lib/hospital-care-queue';

const answerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('respond'), requestId: z.uuid(), status: z.enum(CARE_DECISIONS), note: z.string().trim().max(500) }).strict(),
  z.object({ action: z.literal('mark'), requestId: z.uuid(), milestone: z.enum(['first_contact', 'care_started']) }).strict(),
]);

/** Turns an admin web answer into the one platform-service action it may call; anything else is rejected. */
export function toPlatformCareAnswer(input: unknown):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '처리 상태를 확인해 주세요.' };
  const body = parsed.data;
  if (body.action === 'mark') return { ok: true, payload: { action: 'mark_hospital_care', requestId: body.requestId, milestone: body.milestone } };
  if (decisionNeedsNote(body.status) && !body.note) return { ok: false, error: '회원에게 보낼 안내를 입력해 주세요.' };
  return { ok: true, payload: { action: 'respond_hospital_care', requestId: body.requestId, status: body.status, note: body.note || null } };
}

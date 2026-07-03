export type {
  AdminWorkflowStepNumber,
  AllowanceDisplay,
  AllowanceDisplayKey,
  WorkflowStepNumber,
} from './fc-workflow';

export {
  ALLOWANCE_PASSED_STATUSES,
  HANWHA_APPROVED_STATUSES,
  calcAdminWorkflowStep,
  calcWorkflowStep,
  getAllowanceDisplayState,
  getApprovedDocumentState,
  getCommissionCompletionState,
  hasAllowancePassed,
  hasAppointmentWorkflowEvidence,
  hasDawichokDocumentsSent,
  hasFinalCompletionEvidence,
  hasHanwhaApprovalEvidence,
  hasHanwhaApprovedPdf,
  hasHanwhaPdfMetadata,
  hasIdentityInfo,
  hasText,
  hasUrlStageAccess,
} from './fc-workflow';

import { getCommissionCompletionState } from './fc-workflow';
import type { FcProfile } from '../types/fc';

type WorkflowProfile = Parameters<typeof getCommissionCompletionState>[0];

export const resolveAppointmentCompletionStatus = (
  profile?: WorkflowProfile | null,
): FcProfile['status'] => {
  const { bothCompleted } = getCommissionCompletionState(profile);
  return bothCompleted ? 'final-link-sent' : 'appointment-completed';
};

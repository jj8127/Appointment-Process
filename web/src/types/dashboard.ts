/**
 * Admin Web Dashboard Type Definitions
 *
 * These types extend the base FcProfile types with web-specific
 * document and UI state information.
 */

import type { FcProfile } from '@/types/fc';

/**
 * Document uploaded by FC
 */
export interface FCDocument {
  id?: string;
  fc_id?: string;
  doc_type: string;
  storage_path: string | null;
  file_name?: string | null;
  status?: 'pending' | 'approved' | 'rejected' | null;
  reviewer_note?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * FC Profile with embedded documents array
 * Used in dashboard list view and detail modals
 */
export interface FCProfileWithDocuments extends FcProfile {
  fc_documents?: FCDocument[];
  appointment_date_life_sub?: string | null;
  appointment_date_nonlife_sub?: string | null;
  step?: number; // Calculated workflow step (1-5)
  adminStep?: number; // Admin view step (0-4)
}

/**
 * Step keys for dashboard workflow stages
 */
export type StepKey = 'step1' | 'step2' | 'step3' | 'step4' | 'step5';

/**
 * Modal mode types
 */
export type ModalMode = 'detail' | 'tempId' | 'career' | 'docs' | 'allowance' | 'appointment';

/**
 * Form input types for batch operations
 */
export interface TempIdInput {
  [fcId: string]: string;
}

export interface CareerTypeInput {
  [fcId: string]: '신입' | '경력';
}

export interface DocSelection {
  [fcId: string]: Set<string>;
}

export interface DocDeadlineInput {
  [fcId: string]: string;
}

/**
 * API Action Payloads
 */
export interface UpdateTempIdPayload {
  fcId: string;
  tempId: string;
}

export interface UpdateCareerTypePayload {
  fcId: string;
  careerType: '신입' | '경력';
}

export interface UpdateDocsPayload {
  fcId: string;
  selectedDocs: string[];
  deadline: string | null;
}

export interface UpdateAllowancePayload {
  fcId: string;
  allowanceDate: string | null;
  approved: boolean;
  rejectReason?: string | null;
}

export interface UpdateAppointmentPayload {
  fcId: string;
  phone: string;
  type: 'schedule' | 'confirm' | 'reject';
  category: 'life' | 'nonlife';
  value: string | null;
  reason?: string | null;
}

export interface UpdateDocStatusPayload {
  fcId: string;
  docType: string;
  status: 'approved' | 'rejected';
  reviewerNote?: string | null;
}

export interface DeleteDocPayload {
  fcId: string;
  docType: string;
}

/**
 * Action response types
 */
export interface ActionSuccess<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ActionError {
  success: false;
  error: string;
  code?: string;
  details?: string;
}

export type ActionResult<T = unknown> = ActionSuccess<T> | ActionError;

/**
 * Reject target types for rejection modal
 */
export type RejectTarget =
  | { kind: 'allowance' }
  | { kind: 'appointment'; category: 'life' | 'nonlife' }
  | { kind: 'doc'; doc: FCDocument }
  | null;

/**
 * Document statistics for badge display
 */
export interface DocStats {
  submitted: number;
  approved: number;
  pending: number;
  rejected: number;
  total: number;
}

/**
 * Appointment inputs for dual-track workflow
 */
export interface AppointmentInputs {
  life?: string;
  nonlife?: string;
  lifeDate?: Date | null;
  nonLifeDate?: Date | null;
}

/**
 * Filter and search state
 */
export interface DashboardFilters {
  activeTab: string | null;
  keyword: string;
  dateRange?: {
    from: Date | null;
    to: Date | null;
  };
}

/**
 * Dashboard metrics
 */
export interface DashboardMetrics {
  totalFcs: number;
  pendingApprovals: number;
  completedToday: number;
  documentsToReview: number;
}

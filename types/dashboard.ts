import { FcProfile, FcStatus } from './fc';

// Dashboard specific types
export interface FCDocument {
  doc_type: string;
  storage_path: string | null;
  file_name?: string | null;
  status?: 'pending' | 'approved' | 'rejected' | null;
  reviewer_note?: string | null;
}

export interface FCProfileWithDocuments extends FcProfile {
  fc_documents?: FCDocument[];
}

// Step types
export type StepKey = 'step1' | 'step2' | 'step3' | 'step4' | 'step5';

export interface StepInfo {
  key: StepKey;
  label: string;
  progress: number;
}

// Filter types
export type FilterKey = 'all' | StepKey;

export interface FilterOption {
  key: FilterKey;
  label: string;
  predicate: (fc: FCProfileWithStep) => boolean;
}

export interface FCProfileWithStep extends FCProfileWithDocuments {
  stepKey: StepKey;
}

// Form input types
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

export interface EditModeState {
  [fcId: string]: boolean;
}

// Appointment types
export interface AppointmentInputs {
  life?: string;
  nonlife?: string;
  lifeDate?: Date | null;
  nonLifeDate?: Date | null;
}

export interface AppointmentData {
  fcId: string;
  type: 'life' | 'nonlife';
  schedule?: string;
  date?: string;
  approved?: boolean;
  rejectReason?: string;
}

// Modal types
export type ModalMode = 'detail' | 'tempId' | 'career' | 'docs' | 'allowance' | 'appointment';

export interface ModalState {
  isOpen: boolean;
  mode: ModalMode | null;
  selectedFc: FCProfileWithDocuments | null;
}

// API Response types
export interface UpdateTempIdPayload {
  fcId: string;
  tempId: string;
}

export interface UpdateCareerTypePayload {
  fcId: string;
  careerType: '신입' | '경력';
}

export interface UpdateDocDeadlinePayload {
  fcId: string;
  deadline: string | null;
}

export interface UpdateAllowanceDatePayload {
  fcId: string;
  date: string;
  approved: boolean;
}

export interface RejectAllowancePayload {
  fcId: string;
  reason: string;
}

export interface UpdateDocStatusPayload {
  fcId: string;
  docType: string;
  status: 'approved' | 'rejected';
  reviewerNote?: string;
}

// Push notification types
export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface DeviceToken {
  expo_push_token: string;
}

// Date picker event types
export interface DatePickerEvent {
  type: 'set' | 'dismissed';
  nativeEvent?: {
    timestamp?: number;
  };
}

// Component prop types
export interface FCRowProps {
  fc: FCProfileWithStep;
  isAdmin: boolean;
  readOnly: boolean;
  onPress: () => void;
  tempIdInput: string;
  careerInput: '신입' | '경력' | null;
  editMode: boolean;
  onTempIdChange: (value: string) => void;
  onCareerChange: (value: '신입' | '경력') => void;
  onEditToggle: () => void;
  onSave: () => void;
}

export interface DetailRowProps {
  label: string;
  value: string;
}

// Error types
export interface ApiError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

// Supabase query types
export interface SupabaseError {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
}

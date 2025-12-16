export type CareerType = '신입' | '경력' | null;

export type FcStatus =
  | 'draft'
  | 'temp-id-issued'
  | 'allowance-pending'
  | 'allowance-consented'
  | 'docs-requested'
  | 'docs-pending'
  | 'docs-submitted'
  | 'docs-rejected'
  | 'docs-approved'
  | 'appointment-completed'
  | 'final-link-sent';

// 기본 제공 문자열 외에도 커스텀 서류명이 들어올 수 있으므로 string 으로 확장
export type DocumentType = string;

export type RequiredDocType = DocumentType;

export type FcProfile = {
  id: string;
  name: string;
  affiliation: string;
  phone: string;
  recommender?: string | null;
  email?: string | null;
  address?: string | null;
  address_detail?: string | null;
  resident_id_masked?: string | null;
  career_type?: CareerType;
  temp_id?: string | null;
  allowance_date?: string | null;
  appointment_url?: string | null;
  appointment_date?: string | null;
  appointment_schedule_life?: string | null;
  appointment_schedule_nonlife?: string | null;
  appointment_date_life?: string | null;
  appointment_date_nonlife?: string | null;
  status: FcStatus;
  is_tour_seen?: boolean;
  created_at: string;
  fc_documents?: {
    doc_type: string;
    storage_path: string | null;
    file_name?: string | null;
    status?: string | null;
  }[];
};

export type RequiredDoc = {
  type: DocumentType;
  required: boolean;
  uploadedUrl?: string;
  status?: 'pending' | 'approved' | 'rejected';
  reviewerNote?: string;
};

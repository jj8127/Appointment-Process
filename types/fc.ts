export type CareerType = '신입' | '경력';

export type FcStatus =
  | 'draft'
  | 'temp-id-issued'
  | 'allowance-consented'
  | 'docs-requested'
  | 'docs-pending'
  | 'docs-submitted'
  | 'docs-rejected'
  | 'docs-approved'
  | 'appointment-completed'
  | 'final-link-sent';

export type DocumentType =
  | '주민등록증 사본'
  | '통장 사본'
  | '최근3개월 급여명세서'
  | '주민등록증 이미지(앞)'
  | '통장 이미지(앞)'
  | '최근3개월 이미지(앞)'
  | '주민등록증 이미지(뒤)'
  | '통장 이미지(뒤)'
  | '최근3개월 이미지(뒤)'
  | '신체검사서'
  | '개인정보동의서'
  | '생명보험 합격증'
  | '제3보험 합격증'
  | '손해보험 합격증'
  | '생명보험 수료증(신입)'
  | '제3보험 수료증(신입)'
  | '손해보험 수료증(신입)'
  | '생명보험 수료증(경력)'
  | '제3보험 수료증(경력)'
  | '손해보험 수료증(경력)'
  | '이클린'
  | '경력증명서';

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
  status: FcStatus;
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

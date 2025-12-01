export type CareerType = '신입' | '경력';

export type FcStatus =
  | 'draft'
  | 'temp-id-issued'
  | 'allowance-consented'
  | 'docs-requested'
  | 'docs-pending'
  | 'docs-rejected'
  | 'docs-approved'
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
  | '신원보증서'
  | '경력증명서';

export type RequiredDocType = DocumentType;

export type FcProfile = {
  id: string;
  name: string;
  affiliation: string;
  residentIdMasked: string;
  phone: string;
  recommender?: string;
  email?: string;
  address?: string;
  careerType: CareerType;
  tempId?: string;
  allowanceDate?: string;
  status: FcStatus;
  createdAt: string;
};

export type RequiredDoc = {
  type: DocumentType;
  required: boolean;
  uploadedUrl?: string;
  status?: 'pending' | 'approved' | 'rejected';
  reviewerNote?: string;
};

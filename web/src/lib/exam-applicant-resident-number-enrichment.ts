type ResidentNumberMap = Record<string, string | null>;

type PhoneCandidateBuilder = (rawResidentId: string, residentDigits: string) => string[];

export type ExamApplicantApplicationType = '신규신청' | '재신청';

export type ExamRegistrationRow = {
  id: string;
  status: string;
  created_at: string;
  round_id?: string | null;
  resident_id: string;
  is_confirmed: boolean;
  is_third_exam?: boolean | null;
  fee_paid_date?: string | null;
  exam_locations?: { location_name?: string | null } | null;
  exam_rounds?: { round_label?: string | null; exam_date?: string | null; exam_type?: string | null } | null;
};

export type ExamApplicantBaseRow = {
  id: string;
  status: string;
  created_at: string;
  round_id: string | null;
  resident_id: string;
  is_confirmed: boolean;
  is_third_exam: boolean;
  application_type: ExamApplicantApplicationType;
  location_name: string;
  round_label: string;
  exam_date: string | null;
  exam_type: string | null;
  fee_paid_date: string | null;
};

export type ExamApplicantProfileRow = {
  id: string;
  phone: string;
  name: string | null;
  affiliation: string | null;
  address: string | null;
};

export type ExamApplicantProfileMatchPlan = {
  fcIds: string[];
  profileByCandidate: Map<string, ExamApplicantProfileRow>;
};

export type EnrichedExamApplicantRow = ExamApplicantBaseRow & {
  name: string;
  phone: string;
  affiliation: string;
  address: string;
};

const RESIDENT_NUMBER_LOOKUP_FAILURE = '주민번호 조회 실패';

function phoneDigits(value: string): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function normalizeExamSubjectKey(row: {
  exam_type?: string | null;
  round_label?: string | null;
  is_third_exam?: boolean | null;
}): string {
  let primarySubject = 'unknown';
  if (row.exam_type === 'life' || row.exam_type === 'nonlife') {
    primarySubject = row.exam_type;
  } else if ((row.round_label ?? '').includes('손해')) {
    primarySubject = 'nonlife';
  } else if ((row.round_label ?? '').includes('생명')) {
    primarySubject = 'life';
  }

  return `${primarySubject}:${row.is_third_exam ? 'third' : 'base'}`;
}

function createdAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildExamApplicantBaseRows(rows: ExamRegistrationRow[]): ExamApplicantBaseRow[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    round_id: row.round_id ?? null,
    resident_id: row.resident_id,
    is_confirmed: row.is_confirmed,
    is_third_exam: row.is_third_exam ?? false,
    application_type: '신규신청',
    location_name: row.exam_locations?.location_name || '미정',
    round_label: row.exam_rounds?.round_label || '-',
    exam_date: row.exam_rounds?.exam_date ?? null,
    exam_type: row.exam_rounds?.exam_type ?? null,
    fee_paid_date: row.fee_paid_date ?? null,
  }));
}

export function applyExamApplicantApplicationTypes<T extends ExamApplicantBaseRow>(
  rows: T[],
): Array<T & { application_type: ExamApplicantApplicationType }> {
  const seenByApplicantAndSubject = new Set<string>();
  const applicationTypeById = new Map<string, ExamApplicantApplicationType>();
  const chronologicalRows = [...rows].sort((a, b) => {
    const createdDiff = createdAtMs(a.created_at) - createdAtMs(b.created_at);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  for (const row of chronologicalRows) {
    const applicantKey = phoneDigits(row.resident_id) || row.resident_id.trim();
    const subjectKey = normalizeExamSubjectKey(row);
    const historyKey = `${applicantKey}:${subjectKey}`;
    const nextType = seenByApplicantAndSubject.has(historyKey) ? '재신청' : '신규신청';
    applicationTypeById.set(row.id, nextType);
    seenByApplicantAndSubject.add(historyKey);
  }

  return rows.map((row) => ({
    ...row,
    application_type: applicationTypeById.get(row.id) ?? '신규신청',
  }));
}

export function buildExamApplicantPhoneCandidates(
  applicants: ExamApplicantBaseRow[],
  buildPhoneCandidates: PhoneCandidateBuilder,
): string[] {
  return Array.from(
    new Set(
      applicants.flatMap((item) =>
        buildPhoneCandidates(String(item.resident_id ?? '').trim(), phoneDigits(item.resident_id)),
      ),
    ),
  ).filter(Boolean);
}

export function buildExamApplicantProfileMatchPlan(
  profiles: ExamApplicantProfileRow[],
  buildPhoneCandidates: PhoneCandidateBuilder,
): ExamApplicantProfileMatchPlan {
  const profileByCandidate = new Map<string, ExamApplicantProfileRow>();
  for (const profile of profiles) {
    const candidates = buildPhoneCandidates(profile.phone, phoneDigits(profile.phone));
    for (const candidate of candidates) {
      profileByCandidate.set(candidate, profile);
    }
  }

  return {
    fcIds: Array.from(new Set(profiles.map((profile) => profile.id).filter(Boolean))),
    profileByCandidate,
  };
}

export function enrichExamApplicantsWithResidentNumbers({
  applicants,
  profileByCandidate,
  residentNumbersByFcId,
  buildPhoneCandidates,
}: {
  applicants: ExamApplicantBaseRow[];
  profileByCandidate: Map<string, ExamApplicantProfileRow>;
  residentNumbersByFcId: ResidentNumberMap;
  buildPhoneCandidates: PhoneCandidateBuilder;
}): EnrichedExamApplicantRow[] {
  return applicants.map((item) => {
    const profile = buildPhoneCandidates(
      String(item.resident_id ?? '').trim(),
      phoneDigits(item.resident_id),
    )
      .map((candidate) => profileByCandidate.get(candidate))
      .find((candidateProfile): candidateProfile is ExamApplicantProfileRow => Boolean(candidateProfile));
    const fullResidentNumber = profile?.id ? residentNumbersByFcId[profile.id] : null;

    return {
      ...item,
      name: profile?.name ?? '이름없음',
      phone: profile?.phone ?? item.resident_id,
      affiliation: profile?.affiliation ?? '-',
      address: profile?.address ?? '-',
      resident_id: fullResidentNumber ?? RESIDENT_NUMBER_LOOKUP_FAILURE,
    };
  });
}

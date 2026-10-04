export type AdminDocumentRow = {
  id: string;
  fc_id: string;
  doc_type: string;
  file_name: string | null;
  storage_path: string | null;
  status: string;
  reviewer_note: string | null;
  created_at: string;
  fc_profiles: { name: string | null; phone: string | null; affiliation: string | null };
};

type DocumentProfile = {
  id: string;
  name?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  fc_documents?: Omit<AdminDocumentRow, 'fc_profiles'>[] | null;
};

export async function fetchAdminFcList<T>(): Promise<T[]> {
  const response = await fetch('/api/admin/list', { credentials: 'same-origin', cache: 'no-store' });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) {
    throw new Error(response.status === 401
      ? '로그인 상태를 확인할 수 없습니다. 다시 로그인해주세요.'
      : '목록을 불러오지 못했습니다. 다시 시도해주세요.');
  }
  return data as T[];
}

export async function fetchAdminDocuments(): Promise<AdminDocumentRow[]> {
  const profiles = await fetchAdminFcList<DocumentProfile>();
  return profiles.flatMap((profile) => (profile.fc_documents ?? []).map((doc) => ({
    ...doc,
    fc_id: profile.id,
    fc_profiles: {
      name: profile.name ?? null,
      phone: profile.phone ?? null,
      affiliation: profile.affiliation ?? null,
    },
  }))).sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function signAdminDocument(fcId: string, path: string): Promise<string> {
  const response = await fetch('/api/admin/fc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'signDoc', payload: { fcId, path } }),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; signedUrl?: string } | null;
  if (!response.ok || !data?.ok || !data.signedUrl) {
    throw new Error(response.status === 401
      ? '파일을 보려면 다시 로그인해주세요.'
      : '파일을 불러오지 못했습니다. 다시 시도해주세요.');
  }
  return data.signedUrl;
}

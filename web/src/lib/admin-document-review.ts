// 서류 관리 3단 화면: 걸러진 서류를 FC별로 묶고, 지금 볼 FC와 서류를 정한다.
// 처리한 서류가 현재 탭에서 빠지면 같은 FC의 다음 서류, 없으면 다음 FC로 자연스럽게 넘어간다.

export type ReviewDocument = {
  id: string;
  fc_id: string;
  status: string;
  created_at: string;
};

export type ReviewGroup<T extends ReviewDocument> = {
  fcId: string;
  docs: T[];
  pendingCount: number;
};

const isPending = (status: string) => status === 'pending' || status === 'submitted';

// Groups keep the order in which each FC first appears in the list.
export function groupDocumentsByFc<T extends ReviewDocument>(docs: readonly T[]): ReviewGroup<T>[] {
  const groups = new Map<string, ReviewGroup<T>>();
  for (const doc of docs) {
    const group = groups.get(doc.fc_id) ?? { fcId: doc.fc_id, docs: [], pendingCount: 0 };
    group.docs.push(doc);
    if (isPending(doc.status)) group.pendingCount += 1;
    groups.set(doc.fc_id, group);
  }
  return [...groups.values()];
}

export function resolveReviewSelection<T extends ReviewDocument>(
  groups: readonly ReviewGroup<T>[],
  selectedFcId: string | null,
  selectedDocId: string | null,
  previousFcIndex = 0,
): { group: ReviewGroup<T> | null; doc: T | null } {
  if (!groups.length) return { group: null, doc: null };
  const group = groups.find((candidate) => candidate.fcId === selectedFcId)
    // The selected FC left the list (all of its documents were handled): take the FC that moved into its place.
    ?? groups[Math.min(Math.max(previousFcIndex, 0), groups.length - 1)];
  const doc = group.docs.find((candidate) => candidate.id === selectedDocId)
    ?? group.docs.find((candidate) => isPending(candidate.status))
    ?? group.docs[0];
  return { group, doc };
}

const FC_DOCUMENTS_BUCKET = 'fc-documents';

const STORAGE_OBJECT_MARKERS = [
  `/storage/v1/object/sign/${FC_DOCUMENTS_BUCKET}/`,
  `/storage/v1/object/public/${FC_DOCUMENTS_BUCKET}/`,
  `/storage/v1/object/authenticated/${FC_DOCUMENTS_BUCKET}/`,
];

const stripUrlTail = (value: string) => value.split(/[?#]/, 1)[0];

const safeDecodeStoragePath = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function normalizeFcDocumentStoragePath(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const isAbsoluteUrl = /^https?:\/\//i.test(raw);
  let candidate = raw;

  if (isAbsoluteUrl || raw.startsWith('/')) {
    try {
      candidate = new URL(raw, 'https://garamin.local').pathname;
    } catch {
      candidate = raw;
    }
  }

  candidate = stripUrlTail(candidate);

  const marker = STORAGE_OBJECT_MARKERS.find((storageMarker) => candidate.includes(storageMarker));
  if (marker) {
    const objectKey = candidate.slice(candidate.indexOf(marker) + marker.length).replace(/^\/+/, '');
    return safeDecodeStoragePath(objectKey);
  }

  if (isAbsoluteUrl) {
    return '';
  }

  const normalized = candidate.replace(/^\/+/, '');
  const bucketPrefix = `${FC_DOCUMENTS_BUCKET}/`;
  const objectKey = normalized.startsWith(bucketPrefix) ? normalized.slice(bucketPrefix.length) : normalized;
  return safeDecodeStoragePath(objectKey);
}

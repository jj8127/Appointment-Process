export function normalizeResidentNumberRouteFcIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  );
}

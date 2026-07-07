export type ExamRoundLocationDraft = {
  id?: string;
  name: string;
  order: number;
};

export type ExamRoundLocationPayload = {
  location_name: string;
  sort_order: number;
};

type BuildExamRoundLocationRowsInput = {
  draftLocations: ExamRoundLocationDraft[];
  pendingLocationName?: string | null;
  pendingLocationOrder?: string | number | null;
};

const normalizeSortOrder = (value: string | number | null | undefined): number => {
  const order = Number(value);
  return Number.isFinite(order) ? order : 0;
};

export function buildExamRoundLocationRows({
  draftLocations,
  pendingLocationName,
  pendingLocationOrder,
}: BuildExamRoundLocationRowsInput): ExamRoundLocationPayload[] {
  const rows: ExamRoundLocationPayload[] = [];
  const seenNames = new Set<string>();

  const addRow = (name: string, order: string | number | null | undefined) => {
    const trimmedName = name.trim();
    if (!trimmedName || seenNames.has(trimmedName)) {
      return;
    }
    seenNames.add(trimmedName);
    rows.push({
      location_name: trimmedName,
      sort_order: normalizeSortOrder(order),
    });
  };

  draftLocations.forEach((location) => addRow(location.name, location.order));
  addRow(pendingLocationName ?? '', pendingLocationOrder);

  return rows;
}

export function hasExamRoundLocationsForSave(
  existingLocationCount: number,
  newLocationRows: ExamRoundLocationPayload[],
): boolean {
  return existingLocationCount + newLocationRows.length > 0;
}

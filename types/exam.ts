export type ExamRound = {
  id: string;
  exam_date: string;
  registration_deadline: string;
  round_label?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type ExamLocation = {
  id: string;
  round_id: string;
  location_name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ExamRoundWithLocations = ExamRound & {
  locations: ExamLocation[];
};

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type ExamRound = {
  id: string;
  // Canonical calendar month (YYYY-MM-01). Optional only while DB rollout is in flight.
  exam_month?: string | null;
  // Nullable to support "미정" (TBD) schedules
  exam_date: string | null;
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

export { formatCalendarDate as formatDate } from '../lib/calendar-date';

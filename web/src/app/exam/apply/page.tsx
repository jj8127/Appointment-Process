import { redirect } from 'next/navigation';

export default function LegacyExamApplyPage() {
  redirect('/dashboard/exam/applicants');
}

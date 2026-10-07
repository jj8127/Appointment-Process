type ExamTransitionError = { code?: string; message?: string };

// Map only the authoritative RPC's structured deadline rejection. Never expose
// arbitrary database diagnostics to clients or infer policy from UI clock data.
export function mapExamCancellationError(error: ExamTransitionError) {
  if (error.code === 'P0001' && error.message === 'exam_cancellation_deadline_passed') {
    return {
      code: 'exam_cancellation_deadline_passed',
      message: '마감된 시험입니다. 취소·변경은 관리자에게 문의해 주세요',
      status: 409,
    };
  }
  const notFound = error.message === 'exam_registration_not_found';
  return {
    code: 'cancel_failed',
    message: notFound
      ? '취소할 시험 신청 내역이 없습니다.'
      : '현재 상태에서는 시험 신청을 취소할 수 없습니다.',
    status: notFound ? 404 : 409,
  };
}

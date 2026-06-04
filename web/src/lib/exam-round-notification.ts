export type ExamRoundType = 'life' | 'nonlife';

export type ExamRoundNotificationPayload = {
  type: 'notify';
  target_role: 'fc';
  target_id: null;
  title: string;
  body: string;
  category: 'exam_round';
  url: '/exam-apply' | '/exam-apply2';
};

export function getExamRoundTargetUrl(examType: ExamRoundType): ExamRoundNotificationPayload['url'] {
  return examType === 'nonlife' ? '/exam-apply2' : '/exam-apply';
}

export function buildExamRoundNotificationPayload({
  title,
  body,
  examType,
}: {
  title: string;
  body: string;
  examType: ExamRoundType;
}): ExamRoundNotificationPayload {
  return {
    type: 'notify',
    target_role: 'fc',
    target_id: null,
    title,
    body,
    category: 'exam_round',
    url: getExamRoundTargetUrl(examType),
  };
}

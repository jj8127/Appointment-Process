type BoardFeedbackAlert = (title: string, message?: string) => void;

export type BoardFeedbackAlertKind =
  | 'reaction-failed'
  | 'comment-create-failed'
  | 'comment-like-failed'
  | 'comment-update-failed'
  | 'comment-delete-failed'
  | 'empty-comment';

const BOARD_FEEDBACK_ALERTS: Record<BoardFeedbackAlertKind, [string, string]> = {
  'reaction-failed': ['오류', '반응 처리에 실패했습니다.'],
  'comment-create-failed': ['오류', '댓글 작성에 실패했습니다.'],
  'comment-like-failed': ['오류', '댓글 좋아요 처리에 실패했습니다.'],
  'comment-update-failed': ['오류', '댓글 수정에 실패했습니다.'],
  'comment-delete-failed': ['오류', '댓글 삭제에 실패했습니다.'],
  'empty-comment': ['입력 오류', '댓글 내용을 입력해주세요.'],
};

export function showBoardFeedbackAlert(
  alert: BoardFeedbackAlert,
  kind: BoardFeedbackAlertKind,
) {
  const [title, message] = BOARD_FEEDBACK_ALERTS[kind];
  alert(title, message);
}

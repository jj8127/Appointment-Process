type BoardCommentActionButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type BoardCommentActionAlert = (
  title: string,
  message?: string,
  buttons?: BoardCommentActionButton[],
) => void;

type BoardCommentActionsOptions = {
  onEdit: () => void;
  onDelete: () => void;
  alert: BoardCommentActionAlert;
};

export function showBoardCommentActions({
  onEdit,
  onDelete,
  alert,
}: BoardCommentActionsOptions): void {
  alert('댓글 관리', undefined, [
    {
      text: '수정',
      onPress: onEdit,
    },
    {
      text: '삭제',
      style: 'destructive',
      onPress: onDelete,
    },
    { text: '취소', style: 'cancel' },
  ]);
}

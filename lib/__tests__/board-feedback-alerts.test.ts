import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { showBoardFeedbackAlert } from '../board-feedback-alerts';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('board feedback alerts', () => {
  it('owns repeated board failure and input alert copy', () => {
    const alert = jest.fn();

    showBoardFeedbackAlert(alert, 'reaction-failed');
    showBoardFeedbackAlert(alert, 'comment-create-failed');
    showBoardFeedbackAlert(alert, 'comment-like-failed');
    showBoardFeedbackAlert(alert, 'comment-update-failed');
    showBoardFeedbackAlert(alert, 'comment-delete-failed');
    showBoardFeedbackAlert(alert, 'empty-comment');

    expect(alert.mock.calls).toEqual([
      ['오류', '반응 처리에 실패했습니다.'],
      ['오류', '댓글 작성에 실패했습니다.'],
      ['오류', '댓글 좋아요 처리에 실패했습니다.'],
      ['오류', '댓글 수정에 실패했습니다.'],
      ['오류', '댓글 삭제에 실패했습니다.'],
      ['입력 오류', '댓글 내용을 입력해주세요.'],
    ]);
  });

  it('keeps mobile and admin board screens on the shared feedback helper', () => {
    for (const source of [
      readRepoFile('app/board.tsx'),
      readRepoFile('app/admin-board-manage.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/board-feedback-alerts'");
      expect(source).toContain('showBoardFeedbackAlert');
      expect(source).not.toContain("Alert.alert('오류', '반응 처리에 실패했습니다.')");
      expect(source).not.toContain("Alert.alert('오류', '댓글 작성에 실패했습니다.')");
      expect(source).not.toContain("Alert.alert('오류', '댓글 좋아요 처리에 실패했습니다.')");
      expect(source).not.toContain("Alert.alert('오류', '댓글 수정에 실패했습니다.')");
      expect(source).not.toContain("Alert.alert('오류', '댓글 삭제에 실패했습니다.')");
      expect(source).not.toContain("Alert.alert('입력 오류', '댓글 내용을 입력해주세요.')");
    }
  });
});

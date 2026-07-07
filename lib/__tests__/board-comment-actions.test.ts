import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { showBoardCommentActions } from '../board-comment-actions';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function extractCommentActionSource(source: string): string {
  const start = source.indexOf('const openCommentActions');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('const toggleThread', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('board comment actions', () => {
  it('shows the shared edit/delete/cancel action sheet contract', () => {
    const calls: unknown[][] = [];
    const onEdit = jest.fn();
    const onDelete = jest.fn();

    showBoardCommentActions({
      onEdit,
      onDelete,
      alert: (...args: unknown[]) => {
        calls.push(args);
      },
    });

    expect(calls).toHaveLength(1);
    const [title, message, buttons] = calls[0] as [string, undefined, {
      text: string;
      style?: string;
      onPress?: () => void;
    }[]];

    expect(title).toBe('댓글 관리');
    expect(message).toBeUndefined();
    expect(buttons.map((button) => button.text)).toEqual(['수정', '삭제', '취소']);
    expect(buttons[1].style).toBe('destructive');
    expect(buttons[2].style).toBe('cancel');

    buttons[0].onPress?.();
    buttons[1].onPress?.();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps mobile and admin board comment menus on the shared helper', () => {
    for (const source of [
      ['board', readRepoFile('app/board.tsx')],
      ['admin-board-manage', readRepoFile('app/admin-board-manage.tsx')],
    ].map(([, source]) => source)) {
      const actionSource = extractCommentActionSource(source);
      expect(source).toContain("from '@/lib/board-comment-actions'");
      expect(actionSource).toContain('showBoardCommentActions');
      expect(actionSource).not.toContain('Alert.alert(');
      expect(actionSource).not.toContain('text:');
      expect(actionSource).not.toContain("style: 'destructive'");
    }
  });
});

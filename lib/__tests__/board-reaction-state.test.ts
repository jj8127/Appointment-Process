import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyBoardReactionUpdate,
  buildBoardReactionCounts,
} from '../board-reaction-state';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('board reaction state', () => {
  it('normalizes missing reaction counts', () => {
    expect(buildBoardReactionCounts({ like: 2, smile: 1 })).toEqual({
      like: 2,
      heart: 0,
      check: 0,
      smile: 1,
    });
  });

  it('adds a first reaction and increments total delta', () => {
    expect(applyBoardReactionUpdate(
      buildBoardReactionCounts({ like: 1 }),
      null,
      'heart',
    )).toEqual({
      nextCounts: { like: 1, heart: 1, check: 0, smile: 0 },
      nextMyReaction: 'heart',
      delta: 1,
    });
  });

  it('switches reactions without changing total delta', () => {
    expect(applyBoardReactionUpdate(
      buildBoardReactionCounts({ like: 1, heart: 3 }),
      'heart',
      'like',
    )).toEqual({
      nextCounts: { like: 2, heart: 2, check: 0, smile: 0 },
      nextMyReaction: 'like',
      delta: 0,
    });
  });

  it('removes the current reaction without dropping below zero', () => {
    expect(applyBoardReactionUpdate(
      buildBoardReactionCounts({ check: 0 }),
      'check',
      'check',
    )).toEqual({
      nextCounts: { like: 0, heart: 0, check: 0, smile: 0 },
      nextMyReaction: null,
      delta: -1,
    });
  });

  it('keeps mobile and admin board screens on the shared reaction helper', () => {
    for (const source of [
      readRepoFile('app/board.tsx'),
      readRepoFile('app/admin-board-manage.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/board-reaction-state'");
      expect(source).toContain('buildBoardReactionCounts');
      expect(source).toContain('applyBoardReactionUpdate');
      expect(source).not.toContain('const buildReactionCounts =');
      expect(source).not.toContain('const applyReactionUpdate =');
    }
  });
});

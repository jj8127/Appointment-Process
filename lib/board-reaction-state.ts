export type BoardReactionKey = 'like' | 'heart' | 'check' | 'smile';
export type BoardReactionCounts = Record<BoardReactionKey, number>;

export type BoardReactionUpdate = {
  nextCounts: BoardReactionCounts;
  nextMyReaction: BoardReactionKey | null;
  delta: number;
};

export const buildBoardReactionCounts = (
  counts?: Partial<BoardReactionCounts>,
): BoardReactionCounts => ({
  like: counts?.like ?? 0,
  heart: counts?.heart ?? 0,
  check: counts?.check ?? 0,
  smile: counts?.smile ?? 0,
});

export const applyBoardReactionUpdate = (
  currentCounts: BoardReactionCounts,
  currentReaction: BoardReactionKey | null,
  nextReaction: BoardReactionKey,
): BoardReactionUpdate => {
  const nextCounts = { ...currentCounts };
  let nextMyReaction: BoardReactionKey | null = nextReaction;
  let delta = 0;

  if (currentReaction === nextReaction) {
    nextMyReaction = null;
    nextCounts[nextReaction] = Math.max(0, nextCounts[nextReaction] - 1);
    delta = -1;
  } else {
    if (currentReaction) {
      nextCounts[currentReaction] = Math.max(0, nextCounts[currentReaction] - 1);
    }
    nextCounts[nextReaction] = nextCounts[nextReaction] + 1;
    delta = currentReaction ? 0 : 1;
  }

  return { nextCounts, nextMyReaction, delta };
};

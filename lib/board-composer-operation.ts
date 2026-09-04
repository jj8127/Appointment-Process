export type BoardComposerOperation = 'save' | 'delete-attachment' | 'pick-attachment';

/** A synchronous lock: React's next render is too late to exclude another tap. */
export function createBoardComposerOperationGate() {
  let active: { operation: BoardComposerOperation } | null = null;

  return {
    get current(): BoardComposerOperation | null {
      return active?.operation ?? null;
    },
    start(operation: BoardComposerOperation): (() => void) | null {
      if (active) return null;
      const owner = { operation };
      active = owner;
      return () => {
        // A repeated/late completion must not unlock the next operation.
        if (active === owner) active = null;
      };
    },
  };
}

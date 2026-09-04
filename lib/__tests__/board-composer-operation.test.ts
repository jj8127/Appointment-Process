import { createBoardComposerOperationGate } from '../board-composer-operation';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('board composer mutation exclusion', () => {
  it('excludes save until deletion and its local snapshot update have both finished', async () => {
    const gate = createBoardComposerOperationGate();
    const deletion = deferred();
    let attachmentIds = ['first', 'second'];
    const finishDelete = gate.start('delete-attachment')!;
    const remove = (async () => {
      try {
        await deletion.promise;
        attachmentIds = attachmentIds.filter((id) => id !== 'first');
      } finally {
        finishDelete();
      }
    })();

    // No React render is involved: same-tick handlers must already be excluded.
    expect(gate.start('save')).toBeNull();
    expect(gate.start('delete-attachment')).toBeNull();
    deletion.resolve();
    expect(gate.start('save')).toBeNull();
    await remove;
    const finishSave = gate.start('save');
    expect(finishSave).not.toBeNull();
    expect(attachmentIds).toEqual(['second']);
    finishSave!();
  });

  it('excludes an already-open delete confirmation and duplicate submit during a save', async () => {
    const gate = createBoardComposerOperationGate();
    const write = deferred();
    const finishSave = gate.start('save')!;
    const save = write.promise.finally(finishSave);

    expect(gate.start('delete-attachment')).toBeNull();
    expect(gate.start('pick-attachment')).toBeNull();
    expect(gate.start('save')).toBeNull();
    write.resolve();
    await save;
    expect(gate.current).toBeNull();
  });

  it('retains the existing attachment on failure and permits retry after settlement', async () => {
    const gate = createBoardComposerOperationGate();
    const deletion = deferred();
    let attachmentIds = ['keep'];
    const finish = gate.start('delete-attachment')!;
    const remove = deletion.promise
      .then(() => { attachmentIds = []; })
      .finally(finish);

    deletion.reject(new Error('offline'));
    await expect(remove).rejects.toThrow('offline');
    expect(attachmentIds).toEqual(['keep']);
    expect(gate.start('delete-attachment')).not.toBeNull();
  });

  it('keeps selection exclusive until a picker resolves or is cancelled', () => {
    const gate = createBoardComposerOperationGate();
    const finish = gate.start('pick-attachment')!;
    expect(gate.start('save')).toBeNull();
    expect(gate.start('pick-attachment')).toBeNull();
    finish();
    expect(gate.start('save')).not.toBeNull();
  });

  it('cannot unlock a later save with an old completion callback', () => {
    const gate = createBoardComposerOperationGate();
    const oldFinish = gate.start('delete-attachment')!;
    oldFinish();
    const finishSave = gate.start('save')!;
    oldFinish();
    expect(gate.start('delete-attachment')).toBeNull();
    expect(gate.current).toBe('save');
    finishSave();
    expect(gate.current).toBeNull();
  });

  it('does not share operation state across editor mounts', () => {
    const first = createBoardComposerOperationGate();
    const second = createBoardComposerOperationGate();
    first.start('delete-attachment');
    expect(second.start('save')).not.toBeNull();
  });
});

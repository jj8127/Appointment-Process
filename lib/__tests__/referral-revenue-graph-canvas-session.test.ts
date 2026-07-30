import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import ts from 'typescript';

type CanvasSessionModule = Pick<
  typeof import(
    '@/components/referral-revenue-graph/ReferralRevenueGraphCanvas'
  ),
  'createNodeDragSessionState' | 'transitionNodeDragSession'
>;

const canvasSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'components/referral-revenue-graph/ReferralRevenueGraphCanvas.tsx',
  ),
  'utf8',
);
const sessionSource = canvasSource
  .split('export type NodeDragSessionState')[1]
  .split('const AnimatedRevenueEdge')[0];
const compiledSession = ts.transpileModule(
  `export type NodeDragSessionState${sessionSource}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const sessionExports: Record<string, unknown> = {};
vm.runInNewContext(compiledSession, { exports: sessionExports });
const {
  createNodeDragSessionState,
  transitionNodeDragSession,
} = sessionExports as CanvasSessionModule;

describe('referral revenue graph node-drag session', () => {
  it('rejects queued callbacks after reset and accepts only the new gesture', () => {
    let state = createNodeDragSessionState(1);
    state = transitionNodeDragSession(
      state,
      { type: 'mount', contextToken: 1 },
    ).state;

    let transition = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 1, gestureToken: 1 },
    );
    expect(transition.accepted).toBe(true);
    state = transition.state;
    expect(transitionNodeDragSession(
      state,
      { type: 'update', contextToken: 1, gestureToken: 1 },
    ).accepted).toBe(true);

    state = transitionNodeDragSession(state, { type: 'unmount' }).state;
    for (const type of ['begin', 'update', 'end', 'settle'] as const) {
      expect(transitionNodeDragSession(
        state,
        { type, contextToken: 1, gestureToken: 1 },
      ).accepted).toBe(false);
    }
    state = transitionNodeDragSession(
      state,
      { type: 'mount', contextToken: 2 },
    ).state;
    expect(transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 1, gestureToken: 1 },
    ).accepted).toBe(false);

    transition = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 2, gestureToken: 2 },
    );
    expect(transition.accepted).toBe(true);
    state = transition.state;
    expect(transitionNodeDragSession(
      state,
      { type: 'end', contextToken: 1, gestureToken: 1 },
    ).accepted).toBe(false);
    expect(transitionNodeDragSession(
      state,
      { type: 'update', contextToken: 2, gestureToken: 2 },
    ).accepted).toBe(true);

    transition = transitionNodeDragSession(
      state,
      { type: 'end', contextToken: 2, gestureToken: 2 },
    );
    expect(transition.accepted).toBe(true);
    state = transition.state;
    expect(transitionNodeDragSession(
      state,
      { type: 'settle', contextToken: 2, gestureToken: 2 },
    ).accepted).toBe(true);
  });

  it('rejects updates and settles after cancellation or unmount', () => {
    let state = transitionNodeDragSession(
      createNodeDragSessionState(4),
      { type: 'mount', contextToken: 4 },
    ).state;
    state = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 4, gestureToken: 7 },
    ).state;
    state = transitionNodeDragSession(
      state,
      { type: 'cancel', contextToken: 4, gestureToken: 7 },
    ).state;

    expect(transitionNodeDragSession(
      state,
      { type: 'update', contextToken: 4, gestureToken: 7 },
    ).accepted).toBe(false);
    expect(transitionNodeDragSession(
      state,
      { type: 'settle', contextToken: 4, gestureToken: 7 },
    ).accepted).toBe(false);

    state = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 4, gestureToken: 8 },
    ).state;
    state = transitionNodeDragSession(state, { type: 'unmount' }).state;
    for (const type of ['begin', 'update', 'end', 'settle'] as const) {
      expect(transitionNodeDragSession(
        state,
        { type, contextToken: 4, gestureToken: 8 },
      ).accepted).toBe(false);
    }
  });

  it('does not let an older gesture supersede a newer active gesture', () => {
    let state = transitionNodeDragSession(
      createNodeDragSessionState(9),
      { type: 'mount', contextToken: 9 },
    ).state;
    state = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 9, gestureToken: 10 },
    ).state;

    expect(transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 9, gestureToken: 9 },
    ).accepted).toBe(false);
    expect(transitionNodeDragSession(
      state,
      { type: 'end', contextToken: 9, gestureToken: 9 },
    ).accepted).toBe(false);
    expect(transitionNodeDragSession(
      state,
      { type: 'update', contextToken: 9, gestureToken: 10 },
    ).accepted).toBe(true);
  });

  it('keeps the committed session unchanged when a speculative transition is discarded', () => {
    let state = transitionNodeDragSession(
      createNodeDragSessionState(20),
      { type: 'mount', contextToken: 20 },
    ).state;
    state = transitionNodeDragSession(
      state,
      { type: 'begin', contextToken: 20, gestureToken: 1 },
    ).state;

    const speculative = transitionNodeDragSession(
      state,
      { type: 'mount', contextToken: 21 },
    );

    expect(speculative.state.contextToken).toBe(21);
    expect(state.contextToken).toBe(20);
    expect(transitionNodeDragSession(
      state,
      { type: 'update', contextToken: 20, gestureToken: 1 },
    ).accepted).toBe(true);
  });
});

import {
  buildBranchChildren, buildBranchShareSegments, createBranchFocusIndex, formatBranchShare,
} from '../referral-branch-focus';

const node = (id: string, parentId: string | null) => ({ id, parentId });

describe('branch focus keeps one hop on screen and shows where the total comes from', () => {
  const nodes = [node('me', null), ...Array.from({ length: 9 }, (_, i) => node(`c${i}`, 'me')), node('g', 'c3'), node('x', 'missing')];
  const values: Record<string, number> = { c0: 50, c1: -30, c2: 900, c3: 10, c4: 70, c5: 0, c6: 40, c7: 5, c8: 20 };
  const index = createBranchFocusIndex(nodes);

  it('sorts direct branches by value and counts each branch’s own direct referrals', () => {
    const children = buildBranchChildren(index, 'me', (id) => values[id] ?? 0);
    expect(children.map((child) => child.id)).toEqual(['c2', 'c4', 'c0', 'c6', 'c8', 'c3', 'c7', 'c5', 'c1']);
    expect(children.find((child) => child.id === 'c3')?.childCount).toBe(1);
    expect(buildBranchChildren(index, 'g', () => 1)).toEqual([]);
  });

  it('builds a 100% stacked bar from positive branches and folds the overflow into one grey segment', () => {
    const children = buildBranchChildren(index, 'me', (id) => values[id] ?? 0);
    const { total, segments, shareOf } = buildBranchShareSegments(children, 4);
    expect(total).toBe(900 + 70 + 50 + 40 + 20 + 10 + 5);
    expect(segments.map((segment) => segment.id)).toEqual(['c2', 'c4', 'c0', null]);
    expect(segments.map((segment) => segment.colorIndex)).toEqual([0, 1, 2, -1]);
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1, 12);
    expect(shareOf(-30)).toBe(0);
    expect(shareOf(0)).toBe(0);
    expect(shareOf(900)).toBeCloseTo(900 / total);
  });

  it('keeps every positive branch coloured when they fit, and has no bar when nothing is positive', () => {
    expect(buildBranchShareSegments([{ id: 'a', value: 3 }, { id: 'b', value: 1 }]).segments)
      .toEqual([{ id: 'a', share: 0.75, colorIndex: 0 }, { id: 'b', share: 0.25, colorIndex: 1 }]);
    expect(buildBranchShareSegments([{ id: 'a', value: -3 }]).segments).toEqual([]);
  });

  it('formats shares without hiding tiny contributions', () => {
    expect(formatBranchShare(0.426)).toBe('43%');
    expect(formatBranchShare(0.004)).toBe('<1%');
    expect(formatBranchShare(0)).toBe('');
  });

  it('builds the breadcrumb path from the root and stops on cycles or unknown parents', () => {
    expect(index.pathTo('g').map((item) => item.id)).toEqual(['me', 'c3', 'g']);
    expect(index.pathTo('x').map((item) => item.id)).toEqual(['x']);
    const cyclic = createBranchFocusIndex([node('a', 'b'), node('b', 'a')]);
    expect(cyclic.pathTo('a').map((item) => item.id)).toEqual(['b', 'a']);
  });
});

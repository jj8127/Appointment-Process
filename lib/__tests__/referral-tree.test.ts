import type { DescendantNode } from '@/components/ReferralTreeNode';
import {
  computeReferralTreeTruncated,
  hasLoadedDirectChildren,
  normalizeSubtreeChildNodes,
} from '@/lib/referral-tree';

const createNode = (overrides: Partial<DescendantNode> = {}): DescendantNode => ({
  fcId: 'node-id',
  parentFcId: null,
  name: 'node',
  affiliation: null,
  code: null,
  directInviteeCount: 0,
  totalDescendantCount: 0,
  depth: 1,
  relationshipSource: 'structured',
  ...overrides,
});

describe('referral-tree helpers', () => {
  it('treats depth-2 preload as loaded for root and first-level nodes only', () => {
    const tree = {
      root: { fcId: 'root', directInviteeCount: 1 },
      descendants: [
        createNode({ fcId: 'child', parentFcId: 'root', depth: 1, directInviteeCount: 1 }),
        createNode({ fcId: 'grandchild', parentFcId: 'child', depth: 2, directInviteeCount: 1 }),
      ],
    };

    expect(hasLoadedDirectChildren(tree, 'root')).toBe(true);
    expect(hasLoadedDirectChildren(tree, 'child')).toBe(true);
    expect(hasLoadedDirectChildren(tree, 'grandchild')).toBe(false);
  });

  it('normalizes subtree child depth against the current screen tree depth', () => {
    const subtreeDescendants = [
      createNode({ fcId: 'deep-child', parentFcId: 'parent', depth: 1 }),
    ];

    expect(normalizeSubtreeChildNodes(subtreeDescendants, 'parent', 2)).toEqual([
      expect.objectContaining({ fcId: 'deep-child', depth: 3 }),
    ]);
  });

  it('marks the tree truncated only while some expandable node still has unloaded children', () => {
    const partiallyLoadedTree = {
      root: { fcId: 'root', directInviteeCount: 1 },
      descendants: [
        createNode({ fcId: 'child', parentFcId: 'root', depth: 1, directInviteeCount: 1 }),
      ],
    };
    const fullyLoadedTree = {
      root: { fcId: 'root', directInviteeCount: 1 },
      descendants: [
        createNode({ fcId: 'child', parentFcId: 'root', depth: 1, directInviteeCount: 1 }),
        createNode({ fcId: 'grandchild', parentFcId: 'child', depth: 2 }),
      ],
    };

    expect(computeReferralTreeTruncated(partiallyLoadedTree)).toBe(true);
    expect(computeReferralTreeTruncated(fullyLoadedTree)).toBe(false);
  });
});

import type { DescendantNode } from '@/components/ReferralTreeNode';

type ReferralTreeRootLike = {
  fcId: string;
  directInviteeCount?: number | null;
};

type ReferralTreeLike = {
  root: ReferralTreeRootLike;
  descendants: DescendantNode[];
};

function getDirectInviteeCount(tree: ReferralTreeLike, fcId: string) {
  if (tree.root.fcId === fcId) {
    return Number(tree.root.directInviteeCount ?? 0);
  }

  return Number(tree.descendants.find((node) => node.fcId === fcId)?.directInviteeCount ?? 0);
}

export function sortDescendants(a: DescendantNode, b: DescendantNode) {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
}

export function getDirectChildren(descendants: DescendantNode[], fcId: string) {
  return descendants.filter((node) => node.parentFcId === fcId);
}

export function countDirectChildren(descendants: DescendantNode[], fcId: string) {
  return getDirectChildren(descendants, fcId).length;
}

export function getNodeAbsoluteDepth(tree: ReferralTreeLike, fcId: string) {
  if (tree.root.fcId === fcId) {
    return 0;
  }

  return tree.descendants.find((node) => node.fcId === fcId)?.depth ?? null;
}

export function hasLoadedDirectChildren(tree: ReferralTreeLike, fcId: string) {
  const expectedChildren = getDirectInviteeCount(tree, fcId);

  if (expectedChildren <= 0) {
    return true;
  }

  return countDirectChildren(tree.descendants, fcId) >= expectedChildren;
}

export function computeReferralTreeTruncated(tree: ReferralTreeLike) {
  if (!hasLoadedDirectChildren(tree, tree.root.fcId)) {
    return true;
  }

  return tree.descendants.some((node) => !hasLoadedDirectChildren(tree, node.fcId));
}

export function normalizeSubtreeChildNodes(
  subtreeDescendants: DescendantNode[],
  parentFcId: string,
  parentDepth: number,
) {
  return subtreeDescendants
    .filter((node) => node.parentFcId === parentFcId)
    .map((node) => ({
      ...node,
      depth: parentDepth + Math.max(1, node.depth),
    }));
}

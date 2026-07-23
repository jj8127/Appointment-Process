import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';

import { DEFAULT_REFERRAL_GRAPH_PHYSICS } from '../types/referral-graph.ts';
import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';
import { buildReferralGraphEdges } from './referral-graph-edges.ts';
import { getReferralGraphNodeRadius } from './referral-graph-highlight.ts';
import { getReferralGraphLinkStyle } from './referral-graph-link-style.ts';
import { buildReferralGraphLayout } from './referral-graph-layout.ts';
import {
  applyReferralGraphDragSpring,
  createReferralGraphClusterSeparationForce,
  createReferralGraphLinkTensionForce,
  getReferralGraphFreeLinkStrength,
  getReferralGraphLinkDistance,
  resolveReferralGraphFreePhysics,
} from './referral-graph-physics.ts';

type FcProfileRow = {
  id: string;
  name: string;
  phone: string | null;
  affiliation: string | null;
  recommender_fc_id: string | null;
  signup_completed: boolean | null;
  appointment_date_life: string | null;
  appointment_date_nonlife: string | null;
  life_commission_completed: boolean | null;
  nonlife_commission_completed: boolean | null;
};

type ReferralCodeRow = {
  fc_id: string;
  code: string;
  is_active: boolean;
  created_at: string;
  disabled_at: string | null;
};

type SimNode = GraphNode & { x: number; y: number; vx?: number; vy?: number };
type SimLink = GraphEdge & { source: string | SimNode; target: string | SimNode };

function readDotEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return values;
}

function normalizeDigits(value?: string | null) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function getEndpointId(value: string | SimNode) {
  return typeof value === 'object' ? value.id : value;
}

function buildDegreeMaps(nodes: GraphNode[], edges: GraphEdge[]) {
  const degreeByNodeId = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const childCountByNodeId = new Map<string, number>(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) ?? 0) + 1);
    degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) ?? 0) + 1);
    childCountByNodeId.set(edge.source, (childCountByNodeId.get(edge.source) ?? 0) + 1);
  }

  return { childCountByNodeId, degreeByNodeId };
}

function segmentCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const epsilon = 1e-6;
  return (
    px >= Math.min(ax, bx) - epsilon
    && px <= Math.max(ax, bx) + epsilon
    && py >= Math.min(ay, by) - epsilon
    && py <= Math.max(ay, by) + epsilon
    && Math.abs(segmentCross(ax, ay, bx, by, px, py)) <= epsilon
  );
}

function disjointSegmentsIntersect(left: SimLink, right: SimLink, nodesById: Map<string, SimNode>) {
  const leftSourceId = getEndpointId(left.source);
  const leftTargetId = getEndpointId(left.target);
  const rightSourceId = getEndpointId(right.source);
  const rightTargetId = getEndpointId(right.target);
  if (
    leftSourceId === rightSourceId
    || leftSourceId === rightTargetId
    || leftTargetId === rightSourceId
    || leftTargetId === rightTargetId
  ) {
    return false;
  }

  const leftSource = nodesById.get(leftSourceId);
  const leftTarget = nodesById.get(leftTargetId);
  const rightSource = nodesById.get(rightSourceId);
  const rightTarget = nodesById.get(rightTargetId);
  if (!leftSource || !leftTarget || !rightSource || !rightTarget) return false;

  const ax = leftSource.x;
  const ay = leftSource.y;
  const bx = leftTarget.x;
  const by = leftTarget.y;
  const cx = rightSource.x;
  const cy = rightSource.y;
  const dx = rightTarget.x;
  const dy = rightTarget.y;
  const epsilon = 1e-6;
  const abC = segmentCross(ax, ay, bx, by, cx, cy);
  const abD = segmentCross(ax, ay, bx, by, dx, dy);
  const cdA = segmentCross(cx, cy, dx, dy, ax, ay);
  const cdB = segmentCross(cx, cy, dx, dy, bx, by);

  if (Math.abs(abC) <= epsilon && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
  if (Math.abs(abD) <= epsilon && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
  if (Math.abs(cdA) <= epsilon && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
  if (Math.abs(cdB) <= epsilon && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;

  return (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  );
}

function countDisjointEdgeCrossings(links: SimLink[], nodes: SimNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < links.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < links.length; rightIndex += 1) {
      if (disjointSegmentsIntersect(links[leftIndex], links[rightIndex], nodesById)) {
        crossings += 1;
      }
    }
  }
  return crossings;
}

function summarizeDisjointEdgeCrossings(links: SimLink[], nodes: SimNode[], rootNodeId?: string) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let total = 0;
  let rootIncident = 0;
  const bySource = new Map<string, number>();
  for (let leftIndex = 0; leftIndex < links.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < links.length; rightIndex += 1) {
      const leftLink = links[leftIndex];
      const rightLink = links[rightIndex];
      if (!disjointSegmentsIntersect(leftLink, rightLink, nodesById)) {
        continue;
      }

      total += 1;
      const endpointIds = [
        getEndpointId(leftLink.source),
        getEndpointId(leftLink.target),
        getEndpointId(rightLink.source),
        getEndpointId(rightLink.target),
      ];
      if (rootNodeId && endpointIds.includes(rootNodeId)) {
        rootIncident += 1;
      }
      for (const sourceId of [getEndpointId(leftLink.source), getEndpointId(rightLink.source)]) {
        bySource.set(sourceId, (bySource.get(sourceId) ?? 0) + 1);
      }
    }
  }

  return {
    mostAffectedSourceCrossingCounts: [...bySource.values()]
      .sort((left, right) => right - left)
      .slice(0, 8),
    rootIncident,
    total,
  };
}

function getDisjointEdgeCrossingVisualSeverity(links: SimLink[], nodes: SimNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let severity = 0;
  for (let leftIndex = 0; leftIndex < links.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < links.length; rightIndex += 1) {
      const leftLink = links[leftIndex];
      const rightLink = links[rightIndex];
      if (!disjointSegmentsIntersect(leftLink, rightLink, nodesById)) {
        continue;
      }

      const leftSource = nodesById.get(getEndpointId(leftLink.source));
      const leftTarget = nodesById.get(getEndpointId(leftLink.target));
      const rightSource = nodesById.get(getEndpointId(rightLink.source));
      const rightTarget = nodesById.get(getEndpointId(rightLink.target));
      if (!leftSource || !leftTarget || !rightSource || !rightTarget) {
        continue;
      }

      const leftStyle = getReferralGraphLinkStyle(leftSource, leftTarget);
      const rightStyle = getReferralGraphLinkStyle(rightSource, rightTarget);
      severity += (leftStyle.alpha * leftStyle.width) * (rightStyle.alpha * rightStyle.width);
    }
  }
  return severity;
}

function minimumPairDistance(nodes: SimNode[]) {
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      minimumDistance = Math.min(
        minimumDistance,
        Math.hypot(nodes[left].x - nodes[right].x, nodes[left].y - nodes[right].y),
      );
    }
  }
  return minimumDistance;
}

function getClosestPairs(nodes: SimNode[], limit = 5) {
  const distances: number[] = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      distances.push(Math.hypot(nodes[left].x - nodes[right].x, nodes[left].y - nodes[right].y));
    }
  }
  return distances.sort((left, right) => left - right).slice(0, limit);
}

function getEdgeLengths(links: SimLink[]) {
  return links.map((link) => {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    return Math.hypot(source.x - target.x, source.y - target.y);
  });
}

function addReferralForces(
  simulation: ReturnType<typeof forceSimulation<SimNode>>,
  simLinks: SimLink[],
  layout: ReturnType<typeof buildReferralGraphLayout>,
  physics: ReturnType<typeof resolveReferralGraphFreePhysics>,
  maps: ReturnType<typeof buildDegreeMaps>,
) {
  const { childCountByNodeId, degreeByNodeId } = maps;

  simulation
    .force('charge', forceManyBody<SimNode>()
      .strength(physics.chargeStrength)
      .distanceMin(physics.chargeDistanceMin)
      .distanceMax(physics.chargeDistanceMax))
    .force('link', forceLink<SimNode, SimLink>(simLinks)
      .id((node) => node.id)
      .distance((link) => getReferralGraphLinkDistance(
        degreeByNodeId.get(getEndpointId(link.source)) ?? 1,
        degreeByNodeId.get(getEndpointId(link.target)) ?? 1,
        physics.linkDistance,
        {
          sourceHasChildren: (childCountByNodeId.get(getEndpointId(link.source)) ?? 0) > 0,
          sourceId: getEndpointId(link.source),
          targetHasChildren: (childCountByNodeId.get(getEndpointId(link.target)) ?? 0) > 0,
          targetId: getEndpointId(link.target),
          sourceChildCount: childCountByNodeId.get(getEndpointId(link.source)) ?? 0,
          targetChildCount: childCountByNodeId.get(getEndpointId(link.target)) ?? 0,
          sourceSubtreeSize: layout.directedSubtreeSizes.get(getEndpointId(link.source)) ?? 1,
          targetSubtreeSize: layout.directedSubtreeSizes.get(getEndpointId(link.target)) ?? 1,
          graphNodeCount: layout.nodeAnchorPositions.size,
        },
      ))
      .strength((link) => {
        const source = getEndpointId(link.source);
        const target = getEndpointId(link.target);
        return getReferralGraphFreeLinkStrength(
          degreeByNodeId.get(source) ?? 1,
          degreeByNodeId.get(target) ?? 1,
          physics.linkStrength,
        );
      })
      .iterations(2))
    .force('collision', forceCollide<SimNode>()
      .radius((node) => Math.max(42, getReferralGraphNodeRadius(node) + physics.collisionPadding))
      .strength(physics.collisionStrength)
      .iterations(physics.collisionIterations))
    .force('component-separation', createReferralGraphClusterSeparationForce<SimNode>({
      clusterRadii: layout.componentRadii,
      gap: physics.componentSeparationGap,
      maxVelocity: 8,
      nodeClusterIndex: layout.nodeComponentIndex,
      singletonGapFactor: 0.5,
      softening: 160,
      strength: physics.componentSeparationStrength,
    }))
    .force('link-tension', createReferralGraphLinkTensionForce<SimNode>(simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId,
      degreeByNodeId,
      graphNodeCount: layout.nodeAnchorPositions.size,
      maxVelocity: 18,
      strength: physics.linkTensionStrength,
      subtreeSizeByNodeId: layout.directedSubtreeSizes,
      thresholdMultiplier: physics.linkTensionThresholdMultiplier,
    }))
    .alphaDecay(physics.alphaDecay)
    .velocityDecay(physics.velocityDecay);

  return simulation;
}

async function loadActualReferralGraph() {
  const webDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const rootDir = path.dirname(webDir);
  const env = {
    ...readDotEnv(path.join(rootDir, '.env.local')),
    ...readDotEnv(path.join(webDir, '.env.local')),
    ...process.env,
  };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: adminRows, error: adminError }, { data: profileRows, error: profileError }, { data: codeRows, error: codeError }] = await Promise.all([
    supabase.from('admin_accounts').select('phone'),
    supabase
      .from('fc_profiles')
      .select('id,name,phone,affiliation,recommender_fc_id,signup_completed,appointment_date_life,appointment_date_nonlife,life_commission_completed,nonlife_commission_completed')
      .order('created_at', { ascending: false }),
    supabase.from('referral_codes').select('fc_id,code,is_active,created_at,disabled_at').order('created_at', { ascending: false }),
  ]);
  if (adminError) throw adminError;
  if (profileError) throw profileError;
  if (codeError) throw codeError;

  const excludedPhones = new Set(
    ((adminRows ?? []) as Array<{ phone: string | null }>)
      .map((row) => normalizeDigits(row.phone))
      .filter((value) => value.length === 11),
  );
  const profiles = ((profileRows ?? []) as FcProfileRow[])
    .filter((row) => /^\d{11}$/.test(normalizeDigits(row.phone)))
    .filter((row) => !String(row.affiliation ?? '').includes('설계매니저'))
    .filter((row) => !excludedPhones.has(normalizeDigits(row.phone)));
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const edges = buildReferralGraphEdges(profiles).filter((edge) => profileIds.has(edge.source) && profileIds.has(edge.target));
  const activeCodeByFc = new Map<string, ReferralCodeRow>();
  const codeHistoryByFc = new Map<string, ReferralCodeRow[]>();
  for (const row of (codeRows ?? []) as ReferralCodeRow[]) {
    const history = codeHistoryByFc.get(row.fc_id) ?? [];
    history.push(row);
    codeHistoryByFc.set(row.fc_id, history);
    if (row.is_active && !activeCodeByFc.has(row.fc_id)) {
      activeCodeByFc.set(row.fc_id, row);
    }
  }
  const degreeByFc = new Map<string, number>();
  const referralCountByFc = new Map<string, number>();
  const inboundCountByFc = new Map<string, number>();
  for (const edge of edges) {
    degreeByFc.set(edge.source, (degreeByFc.get(edge.source) ?? 0) + 1);
    degreeByFc.set(edge.target, (degreeByFc.get(edge.target) ?? 0) + 1);
    referralCountByFc.set(edge.source, (referralCountByFc.get(edge.source) ?? 0) + 1);
    inboundCountByFc.set(edge.target, (inboundCountByFc.get(edge.target) ?? 0) + 1);
  }
  const nodes = profiles.map<GraphNode>((profile) => {
    const activeCodeRow = activeCodeByFc.get(profile.id);
    const codeHistory = codeHistoryByFc.get(profile.id) ?? [];
    const lifeCommissionCompleted = Boolean(profile.life_commission_completed || profile.appointment_date_life);
    const nonlifeCommissionCompleted = Boolean(profile.nonlife_commission_completed || profile.appointment_date_nonlife);
    return {
      id: profile.id,
      name: profile.name,
      phone: profile.phone ?? '',
      affiliation: profile.affiliation ?? '',
      activeCode: activeCodeRow?.code ?? null,
      referralCount: referralCountByFc.get(profile.id) ?? 0,
      inboundCount: inboundCountByFc.get(profile.id) ?? 0,
      nodeStatus: activeCodeRow?.is_active ? 'has_active_code' : codeHistory.length > 0 ? 'code_disabled' : 'missing_code',
      isIsolated: (degreeByFc.get(profile.id) ?? 0) === 0,
      signupCompleted: profile.signup_completed === true,
      allCommissionsCompleted: lifeCommissionCompleted && nonlifeCommissionCompleted,
      hasLegacyUnresolved: false,
      highlightType: null,
    };
  });

  return { nodes, edges };
}

test('actual Supabase referral graph settles with bounded crossings and spacing', async () => {
  const actual = await loadActualReferralGraph();
  assert.ok(actual, 'missing Supabase environment for actual graph test');
  assert.ok(actual.nodes.length >= 100, `actual graph should use current admin-sized data, got ${actual.nodes.length}`);
  assert.ok(actual.edges.length >= 60, `actual graph should include current referral links, got ${actual.edges.length}`);

  const physics = resolveReferralGraphFreePhysics(DEFAULT_REFERRAL_GRAPH_PHYSICS);
  const layout = buildReferralGraphLayout(actual.nodes, actual.edges, physics.linkDistance, getReferralGraphLinkDistance);
  const maps = buildDegreeMaps(actual.nodes, actual.edges);
  const simNodes = actual.nodes.map<SimNode>((node) => ({
    ...node,
    ...(layout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 }),
  }));
  const simLinks = actual.edges.map<SimLink>((edge) => ({ ...edge }));
  const simulation = addReferralForces(forceSimulation(simNodes), simLinks, layout, physics, maps).stop();
  const tickCount = Math.max(0, Number(process.env.REFERRAL_GRAPH_REALDATA_TICKS ?? 720));

  for (let index = 0; index < tickCount; index += 1) {
    simulation.tick();
  }

  const edgeLengths = getEdgeLengths(simLinks);
  const crossings = countDisjointEdgeCrossings(simLinks, simNodes);
  const crossingVisualSeverity = getDisjointEdgeCrossingVisualSeverity(simLinks, simNodes);
  const minDistance = minimumPairDistance(simNodes);
  const closestPairs = getClosestPairs(simNodes);
  const longestEdges = simLinks
    .map((link) => ({
      distance: Math.hypot((link.source as SimNode).x - (link.target as SimNode).x, (link.source as SimNode).y - (link.target as SimNode).y),
    }))
    .sort((left, right) => right.distance - left.distance)
    .slice(0, 5);
  const spokeHub = [...actual.nodes]
    .filter((node) => (maps.degreeByNodeId.get(node.id) ?? 0) >= 8)
    .sort((left, right) => {
      const degreeDelta = (maps.degreeByNodeId.get(right.id) ?? 0) - (maps.degreeByNodeId.get(left.id) ?? 0);
      return degreeDelta || left.id.localeCompare(right.id);
    })[0];
  const spokeHubDirectLengths = spokeHub
    ? simLinks
      .filter((link) => (
        getEndpointId(link.source) === spokeHub.id
        || getEndpointId(link.target) === spokeHub.id
      ))
      .map((link) => Math.hypot((link.source as SimNode).x - (link.target as SimNode).x, (link.source as SimNode).y - (link.target as SimNode).y))
      .sort((left, right) => left - right)
    : [];
  const spokeHubDirectP90 = spokeHubDirectLengths.length
    ? spokeHubDirectLengths[Math.floor(spokeHubDirectLengths.length * 0.9)]
    : 0;

  console.info('[referral-graph-realdata]', {
    nodes: actual.nodes.length,
    edges: actual.edges.length,
    ticks: tickCount,
    crossings,
    crossingVisualSeverity,
    minDistance,
    maxEdge: Math.max(...edgeLengths),
    spokeHubDegree: spokeHub ? maps.degreeByNodeId.get(spokeHub.id) ?? 0 : 0,
    spokeHubDirectMax: Math.max(0, ...spokeHubDirectLengths),
    spokeHubDirectP90,
    closestPairs,
    longestEdges,
  });
  if (process.env.LOG_REFERRAL_GRAPH_CROSSINGS === '1') {
    console.info('[referral-graph-realdata-crossing-summary]', summarizeDisjointEdgeCrossings(simLinks, simNodes, spokeHub?.id));
  }

  assert.ok(crossings <= 8, `actual graph has too many disjoint crossings: ${crossings}`);
  assert.ok(crossingVisualSeverity <= 8, `actual graph has too much visible edge-overlap weight: ${crossingVisualSeverity}`);
  assert.ok(minDistance >= 26, `actual graph has overlapping node centers: ${minDistance}`);
  assert.ok(Math.max(...edgeLengths) <= 430, `actual graph has abnormal stretched edge: ${Math.max(...edgeLengths)}`);
  assert.ok(spokeHubDirectLengths.length >= 8, `missing high-degree direct spoke sample: ${spokeHubDirectLengths.length}`);
  assert.ok(Math.max(...spokeHubDirectLengths) <= 430, `high-degree direct spoke is too long: ${Math.max(...spokeHubDirectLengths)}`);
  assert.ok(spokeHubDirectP90 <= 420, `high-degree direct spokes are too uniformly stretched: p90=${spokeHubDirectP90}`);

  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const draggedNode = spokeHub ? byId.get(spokeHub.id) : null;
  assert.ok(draggedNode, 'missing high-degree drag candidate');
  draggedNode.x += 34;
  draggedNode.y += 16;
  draggedNode.fx = draggedNode.x;
  draggedNode.fy = draggedNode.y;

  for (let index = 0; index < 14; index += 1) {
    applyReferralGraphDragSpring(draggedNode, byId, simLinks, {
      baseLinkDistance: physics.linkDistance,
      childCountByNodeId: maps.childCountByNodeId,
      constraintStrength: 0.42,
      degreeByNodeId: maps.degreeByNodeId,
      graphNodeCount: simNodes.length,
      maxVelocity: 42,
      preventStretch: true,
      stretchSlack: 18,
      strength: 0.52,
      subtreeSizeByNodeId: layout.directedSubtreeSizes,
      velocityDamping: 0.76,
    });
    simulation.tick();
  }

  draggedNode.fx = undefined;
  draggedNode.fy = undefined;
  for (let index = 0; index < 180; index += 1) {
    simulation.tick();
  }

  const afterDragEdgeLengths = getEdgeLengths(simLinks);
  const afterDragCrossings = countDisjointEdgeCrossings(simLinks, simNodes);
  const afterDragCrossingVisualSeverity = getDisjointEdgeCrossingVisualSeverity(simLinks, simNodes);
  const afterDragMinDistance = minimumPairDistance(simNodes);
  console.info('[referral-graph-realdata-after-small-drag]', {
    crossings: afterDragCrossings,
    crossingVisualSeverity: afterDragCrossingVisualSeverity,
    maxEdge: Math.max(...afterDragEdgeLengths),
    minDistance: afterDragMinDistance,
  });

  assert.ok(afterDragCrossings <= Math.max(8, crossings), `small drag should not add excessive crossing edges: ${afterDragCrossings}`);
  assert.ok(afterDragCrossingVisualSeverity <= 8, `small drag added too much visible edge-overlap weight: ${afterDragCrossingVisualSeverity}`);
  assert.ok(afterDragMinDistance >= 24, `small drag should not collapse nodes: ${afterDragMinDistance}`);
  assert.ok(Math.max(...afterDragEdgeLengths) <= 450, `small drag created abnormal stretched edge: ${Math.max(...afterDragEdgeLengths)}`);
});

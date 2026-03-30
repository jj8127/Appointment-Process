'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { AgentRoomAgent, AgentRoomStatus } from '@/types/agent-room';

import styles from './AgentRoomScene.module.css';

type BubblePlacement = {
  align: 'center' | 'left' | 'right';
  offsetY: number;
  text: string;
};

type Slot = {
  x: number;
  y: number;
};

type RoutePoint = {
  x: number;
  y: number;
};

type PositionedAgent = AgentRoomAgent & {
  bubble: BubblePlacement | null;
  facing: 'left' | 'right';
  moving: boolean;
  priority: 'active' | 'recent';
  x: number;
  y: number;
};

type InteractionLink = {
  id: string;
  label: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

const STATUS_LABELS: Record<AgentRoomStatus, string> = {
  coding: 'Coding',
  done: 'Done',
  idle: 'Idle',
  researching: 'Research',
  thinking: 'Thinking',
  waiting: 'Waiting',
};

const ACTIVE_STATUSES: AgentRoomStatus[] = ['coding', 'researching', 'thinking', 'waiting'];

const STATUS_SLOTS: Record<AgentRoomStatus, Slot[]> = {
  researching: [
    { x: 14, y: 20.5 },
    { x: 20.5, y: 20.5 },
    { x: 15.5, y: 30 },
    { x: 23, y: 30.5 },
  ],
  thinking: [
    { x: 39, y: 51 },
    { x: 46.5, y: 47.5 },
    { x: 50.5, y: 56 },
    { x: 35, y: 58.5 },
  ],
  waiting: [
    { x: 67.5, y: 20 },
    { x: 75.5, y: 20 },
    { x: 82, y: 20 },
    { x: 73, y: 29 },
  ],
  coding: [
    { x: 19, y: 73 },
    { x: 30, y: 73 },
    { x: 19, y: 84 },
    { x: 30, y: 84 },
    { x: 42, y: 77 },
    { x: 49.5, y: 77 },
  ],
  done: [
    { x: 73.5, y: 73.5 },
    { x: 81.5, y: 73.5 },
    { x: 77.5, y: 83.5 },
  ],
  idle: [],
};

const HUB_ANCHOR: RoutePoint = { x: 46, y: 56 };

const STATUS_TRANSITS: Record<AgentRoomStatus, RoutePoint[]> = {
  researching: [
    { x: 31.5, y: 34 },
    { x: 31.5, y: 38 },
    { x: 46, y: 38 },
    HUB_ANCHOR,
  ],
  thinking: [HUB_ANCHOR],
  waiting: [
    { x: 63.5, y: 34 },
    { x: 63.5, y: 38 },
    { x: 46, y: 38 },
    HUB_ANCHOR,
  ],
  coding: [
    { x: 39.5, y: 63 },
    { x: 39.5, y: 60 },
    HUB_ANCHOR,
  ],
  done: [
    { x: 59.5, y: 60 },
    HUB_ANCHOR,
  ],
  idle: [
    { x: 46, y: 84 },
    { x: 46, y: 74 },
    HUB_ANCHOR,
  ],
};

const OFF_STAGE_ROUTE: RoutePoint[] = [
  { x: 46, y: 92 },
  { x: 46, y: 86 },
  { x: 46, y: 78 },
  HUB_ANCHOR,
];

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

function sortAgents(agents: AgentRoomAgent[]) {
  return [...agents].sort((left, right) => {
    const leftTime = parseTimestamp(left.updatedAt);
    const rightTime = parseTimestamp(right.updatedAt);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.name.localeCompare(right.name);
  });
}

function compactDetail(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, ' ').replace(/[|/]+/g, ' · ').trim();
  if (!normalized) {
    return fallback;
  }

  const limit = /[가-힣]/.test(normalized) ? 24 : 34;
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1).trimEnd()}...`;
}

function getBubbleText(agent: AgentRoomAgent) {
  switch (agent.status) {
    case 'coding':
      return compactDetail(agent.detail, '코드 작업 진행 중');
    case 'done':
      return compactDetail(agent.detail, '작업을 마쳤습니다');
    case 'researching':
      return compactDetail(agent.detail, '자료를 찾는 중');
    case 'thinking':
      return compactDetail(agent.detail, '내부 추론 정리 중');
    case 'waiting':
      return compactDetail(agent.detail, '다음 입력을 기다리는 중');
    case 'idle':
      return null;
  }
}

function getStableOffset(id: string, axis: 'x' | 'y') {
  const seed = hashString(`${id}:${axis}`);
  const amplitude = axis === 'x' ? 0.72 : 0.56;
  return ((seed % 1000) / 1000 - 0.5) * amplitude * 2;
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getLinkStyle(link: InteractionLink): CSSProperties {
  const dx = link.x2 - link.x1;
  const dy = link.y2 - link.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return {
    left: `${link.x1}%`,
    top: `${link.y1}%`,
    transform: `translateY(-50%) rotate(${angle}deg)`,
    width: `${length}%`,
  };
}

function getStatusSlots(status: AgentRoomStatus) {
  return STATUS_SLOTS[status] ?? [];
}

function dedupePath(points: RoutePoint[]) {
  return points.filter((point, index, list) => index === 0 || distance(point, list[index - 1]) > 0.3);
}

function getRouteLength(points: RoutePoint[]) {
  if (points.length < 2) {
    return 0;
  }

  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

function getPointAlongRoute(points: RoutePoint[], progress: number) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return points[0];
  }

  const totalLength = getRouteLength(points);
  if (totalLength === 0) {
    return points.at(-1) ?? points[0];
  }

  const targetLength = totalLength * progress;
  let traversed = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);

    if (traversed + segmentLength >= targetLength) {
      const localProgress = (targetLength - traversed) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * localProgress,
        y: start.y + (end.y - start.y) * localProgress,
      };
    }

    traversed += segmentLength;
  }

  return points.at(-1) ?? points[0];
}

function easeWalkingProgress(progress: number) {
  return 0.5 - Math.cos(progress * Math.PI) / 2;
}

function buildRoute(from: PositionedAgent | undefined, to: PositionedAgent) {
  const destination = { x: to.x, y: to.y };

  if (!from) {
    const entryPath = [...(STATUS_TRANSITS[to.status] ?? [HUB_ANCHOR])].reverse();
    return dedupePath([...OFF_STAGE_ROUTE, ...entryPath, destination]);
  }

  const origin = { x: from.x, y: from.y };
  if (distance(origin, destination) < 0.8) {
    return [destination];
  }

  if (from.status === to.status) {
    const sameRoomRoute = distance(origin, destination) > 2.6
      ? [origin, { x: origin.x, y: destination.y }, destination]
      : [origin, destination];

    return dedupePath(sameRoomRoute);
  }

  const exitPath = STATUS_TRANSITS[from.status] ?? [HUB_ANCHOR];
  const entryPath = [...(STATUS_TRANSITS[to.status] ?? [HUB_ANCHOR])].reverse();

  return dedupePath([origin, ...exitPath, ...entryPath, destination]);
}

function placeAgents(agents: AgentRoomAgent[]) {
  const stageAgents = sortAgents(agents);
  const groups = new Map<AgentRoomStatus, AgentRoomAgent[]>();

  for (const agent of stageAgents) {
    const bucket = groups.get(agent.status) ?? [];
    bucket.push(agent);
    groups.set(agent.status, bucket);
  }

  const positionedAgents: PositionedAgent[] = [];

  for (const [status, statusAgents] of groups.entries()) {
    const slots = getStatusSlots(status);

    statusAgents.forEach((agent, index) => {
      const slot = slots[index % Math.max(slots.length, 1)] ?? { x: 50, y: 50 };
      const overflow = Math.floor(index / Math.max(slots.length, 1));
      const extraX = (overflow % 2 === 0 ? -1 : 1) * 1.3;
      const extraY = Math.floor(overflow / 2) * 1.1;
      const jitterX = getStableOffset(agent.id, 'x');
      const jitterY = getStableOffset(agent.id, 'y');

      positionedAgents.push({
        ...agent,
        bubble: null,
        facing: jitterX >= 0 ? 'right' : 'left',
        moving: false,
        priority: ACTIVE_STATUSES.includes(status) ? 'active' : 'recent',
        x: clamp(slot.x + extraX + jitterX, 8, 92),
        y: clamp(slot.y + extraY + jitterY, 11, 90),
      });
    });
  }

  const byId = new Map(positionedAgents.map((agent) => [agent.id, agent] as const));
  const bubbleTargets = positionedAgents
    .filter((agent) => agent.status !== 'idle')
    .sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt))
    .slice(0, 3);

  bubbleTargets.forEach((agent, index) => {
    let align: BubblePlacement['align'] = 'center';
    if (agent.x < 24) {
      align = 'left';
    } else if (agent.x > 76) {
      align = 'right';
    }

    agent.bubble = {
      align,
      offsetY: index === 0 ? -12 : -4 - index * 2,
      text: getBubbleText(agent) ?? STATUS_LABELS[agent.status],
    };
  });

  const sceneLinks: InteractionLink[] = [];

  for (const agent of bubbleTargets) {
    if (!agent.parentId) {
      continue;
    }

    const parent = byId.get(agent.parentId);
    if (!parent || distance(agent, parent) > 20) {
      continue;
    }

    sceneLinks.push({
      id: `${parent.id}-${agent.id}`,
      label: 'handoff',
      x1: parent.x,
      x2: agent.x,
      y1: parent.y,
      y2: agent.y,
    });
  }

  return {
    interactionLinks: sceneLinks.slice(0, 2),
    positionedAgents,
  };
}

function getCharacterSheet(agent: AgentRoomAgent) {
  const index = hashString(`${agent.vendor}:${agent.name}`) % 6;
  return `/agent-room-assets/characters/char_${index}.png`;
}

function getAgentStyle(agent: PositionedAgent): CSSProperties {
  const statusGlow: Record<AgentRoomStatus, string> = {
    coding: 'rgba(245, 133, 61, 0.34)',
    done: 'rgba(102, 197, 123, 0.3)',
    idle: 'rgba(146, 158, 171, 0.14)',
    researching: 'rgba(86, 166, 255, 0.24)',
    thinking: 'rgba(147, 113, 255, 0.2)',
    waiting: 'rgba(234, 197, 90, 0.2)',
  };

  return {
    '--agent-glow': statusGlow[agent.status],
    '--bubble-offset-y': `${agent.bubble?.offsetY ?? 0}px`,
    '--character-sheet': `url("${getCharacterSheet(agent)}")`,
    left: `${agent.x}%`,
    top: `${agent.y}%`,
  } as CSSProperties;
}

export function AgentRoomScene({ agents }: { agents: AgentRoomAgent[] }) {
  const frameRef = useRef<number | null>(null);
  const targets = useMemo(() => placeAgents(agents), [agents]);
  const sceneLinks = targets.interactionLinks ?? [];
  const [positionedAgents, setPositionedAgents] = useState<PositionedAgent[]>(targets.positionedAgents ?? []);
  const positionedAgentsRef = useRef(positionedAgents);

  useEffect(() => {
    positionedAgentsRef.current = positionedAgents;
  }, [positionedAgents]);

  useEffect(() => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
    }

    const previousMap = new Map(positionedAgentsRef.current.map((agent) => [agent.id, agent] as const));
    const animationStart = performance.now();
    const plans = new Map(
      targets.positionedAgents.map((target) => {
        const previous = previousMap.get(target.id);
        const route = buildRoute(previous, target);
        const routeLength = getRouteLength(route);

        return [
          target.id,
          {
            previous,
            route,
            routeLength,
            target,
            duration: clamp(routeLength * 165, 1500, 6800),
          },
        ] as const;
      }),
    );

    const hasTravel = [...plans.values()].some((plan) => plan.previous && plan.routeLength > 0.8);
    if (!hasTravel) {
      frameRef.current = window.requestAnimationFrame(() => {
        positionedAgentsRef.current = targets.positionedAgents;
        setPositionedAgents(targets.positionedAgents);
      });

      return () => {
        if (frameRef.current) {
          window.cancelAnimationFrame(frameRef.current);
        }
      };
    }

    const animate = (now: number) => {
      let stillMoving = false;

      const nextAgents = targets.positionedAgents.map((target) => {
        const plan = plans.get(target.id);
        if (!plan?.previous || plan.routeLength <= 0.8) {
          return { ...target, moving: false };
        }

        const progress = clamp((now - animationStart) / plan.duration, 0, 1);
        const easedProgress = easeWalkingProgress(progress);
        const lookAheadProgress = Math.min(1, progress + 0.035);
        const point = getPointAlongRoute(plan.route, easedProgress);
        const lookAhead = getPointAlongRoute(plan.route, easeWalkingProgress(lookAheadProgress));
        const facing: PositionedAgent['facing'] = lookAhead.x < point.x - 0.04 ? 'left' : 'right';
        const moving = progress < 1;

        if (moving) {
          stillMoving = true;
        }

        return {
          ...target,
          facing,
          moving,
          x: point.x,
          y: point.y,
        };
      });

      positionedAgentsRef.current = nextAgents;
      setPositionedAgents(nextAgents);

      if (stillMoving) {
        frameRef.current = window.requestAnimationFrame(animate);
      }
    };

    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [targets]);

  return (
    <div className={styles.sceneShell}>
      <div className={styles.map}>
        <div className={styles.topGarden}>
          {Array.from({ length: 9 }).map((_, index) => (
            <span
              key={`tree-${index}`}
              className={styles.tree}
              style={{ left: `${index * 11 + 3}%` }}
            />
          ))}
        </div>

        <div className={styles.floor}>
          <div className={`${styles.connector} ${styles.northPromenade}`} />
          <div className={`${styles.connector} ${styles.hubSpine}`} />
          <div className={`${styles.connector} ${styles.codingWalk}`} />
          <div className={`${styles.connector} ${styles.reviewWalk}`} />
          <div className={`${styles.threshold} ${styles.terraceThreshold}`} />
          <div className={`${styles.threshold} ${styles.supportThreshold}`} />
          <div className={`${styles.threshold} ${styles.loungeThreshold}`} />
          <div className={`${styles.threshold} ${styles.codingThreshold}`} />
          <div className={`${styles.threshold} ${styles.reviewThreshold}`} />

          <div className={`${styles.room} ${styles.terrace}`}>
            <div className={styles.roomLabel}>Search Terrace</div>
            <div className={`${styles.sprite} ${styles.terraceTable}`} />
            <div className={`${styles.sprite} ${styles.terraceTableAlt}`} />
            <div className={`${styles.sprite} ${styles.terraceBenchLeft}`} />
            <div className={`${styles.sprite} ${styles.terraceBenchRight}`} />
            <div className={`${styles.sprite} ${styles.terraceBenchAltLeft}`} />
            <div className={`${styles.sprite} ${styles.terraceBenchAltRight}`} />
            <div className={`${styles.sprite} ${styles.terracePlantLeft}`} />
            <div className={`${styles.sprite} ${styles.terracePlantRight}`} />
          </div>

          <div className={`${styles.room} ${styles.supportRoom}`}>
            <div className={styles.roomLabel}>Support Room</div>
            <div className={`${styles.sprite} ${styles.supportShelfLeft}`} />
            <div className={`${styles.sprite} ${styles.supportShelfRight}`} />
            <div className={`${styles.sprite} ${styles.supportDesk}`} />
            <div className={`${styles.sprite} ${styles.supportPc}`} />
            <div className={`${styles.sprite} ${styles.supportPainting}`} />
            <div className={`${styles.sprite} ${styles.supportPlant}`} />
          </div>

          <div className={`${styles.room} ${styles.lounge}`}>
            <div className={styles.roomLabel}>Waiting Lounge</div>
            <div className={`${styles.sprite} ${styles.loungeSofaFront}`} />
            <div className={`${styles.sprite} ${styles.loungeSofaLeft}`} />
            <div className={`${styles.sprite} ${styles.loungeSofaRight}`} />
            <div className={`${styles.sprite} ${styles.loungeCoffeeTable}`} />
            <div className={`${styles.sprite} ${styles.loungeShelfLeft}`} />
            <div className={`${styles.sprite} ${styles.loungeSideTable}`} />
            <div className={`${styles.sprite} ${styles.loungePainting}`} />
            <div className={`${styles.sprite} ${styles.loungePlant}`} />
          </div>

          <div className={`${styles.room} ${styles.workNook}`}>
            <div className={`${styles.sprite} ${styles.nookDesk}`} />
            <div className={`${styles.sprite} ${styles.nookPc}`} />
            <div className={`${styles.sprite} ${styles.nookShelf}`} />
            <div className={`${styles.sprite} ${styles.nookPlant}`} />
          </div>

          <div className={`${styles.room} ${styles.codingStudio}`}>
            <div className={styles.roomLabel}>Coding Pods</div>
            <div className={styles.checkerCarpet} />
            <div className={`${styles.sprite} ${styles.codeDeskLeft}`} />
            <div className={`${styles.sprite} ${styles.codeDeskRight}`} />
            <div className={`${styles.sprite} ${styles.codePcLeft}`} />
            <div className={`${styles.sprite} ${styles.codePcRight}`} />
            <div className={`${styles.sprite} ${styles.codeBenchLeft}`} />
            <div className={`${styles.sprite} ${styles.codeBenchRight}`} />
            <div className={`${styles.sprite} ${styles.codeTable}`} />
            <div className={`${styles.sprite} ${styles.codeShelfLeft}`} />
            <div className={`${styles.sprite} ${styles.codeShelfRight}`} />
            <div className={`${styles.sprite} ${styles.codeWhiteboard}`} />
          </div>

          <div className={`${styles.room} ${styles.meetingRoom}`}>
            <div className={styles.roomLabel}>Review Bay</div>
            <div className={`${styles.sprite} ${styles.meetingWhiteboard}`} />
            <div className={`${styles.sprite} ${styles.meetingTable}`} />
            <div className={`${styles.sprite} ${styles.meetingBenchTop}`} />
            <div className={`${styles.sprite} ${styles.meetingBenchBottom}`} />
            <div className={`${styles.sprite} ${styles.meetingShelf}`} />
            <div className={`${styles.sprite} ${styles.meetingPlant}`} />
          </div>

          <div className={styles.centralSteps}>
            <div className={styles.stepRail} />
            <div className={styles.stepLanding} />
            <div className={`${styles.sprite} ${styles.centralDesk}`} />
            <div className={`${styles.sprite} ${styles.centralPc}`} />
            <div className={`${styles.sprite} ${styles.centralPlant}`} />
            <div className={`${styles.sprite} ${styles.centralPainting}`} />
            <div className={`${styles.sprite} ${styles.hallShelf}`} />
          </div>

          <div className={styles.windowBand} />
        </div>
        {sceneLinks.map((link) => (
          <div key={link.id} className={styles.link} style={getLinkStyle(link)}>
            <span className={styles.linkLabel}>{link.label}</span>
          </div>
        ))}

        {positionedAgents.map((agent) => (
          <article
            key={agent.id}
            className={styles.agent}
            data-bubble-align={agent.bubble?.align ?? 'center'}
            data-facing={agent.facing}
            data-moving={agent.moving ? 'true' : 'false'}
            data-priority={agent.priority}
            data-status={agent.status}
            style={getAgentStyle(agent)}
            title={`${agent.name} · ${STATUS_LABELS[agent.status]}`}
          >
            {agent.bubble ? <div className={styles.bubble}>{agent.bubble.text}</div> : null}

            <div className={styles.avatar}>
              <span className={styles.shadow} />
              <span className={styles.ring} />
              <span className={styles.spriteAvatar} />
            </div>

            <div className={styles.nameTag}>
              <span className={styles.nameText}>{agent.name}</span>
              <span className={styles.statusChip}>{STATUS_LABELS[agent.status]}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef } from 'react';

import { logger } from '@/lib/logger';

/**
 * 메신저 체감 지연 기준선 측정 (로드맵 0단계).
 * 7개 지표의 정의와 합격 기준은 '모두온 메신저 설계 기준' 문서의 '측정 방법과 합격 기준'을 따른다.
 * 이 모듈은 Sentry를 직접 import하지 않고, lib/sentry.ts가 reporter를 주입한다.
 */
export type MessengerLatencyMetric =
  | 'room_list_render'
  | 'room_render'
  | 'send_ack'
  | 'peer_delivery'
  | 'push_delivery'
  | 'older_page'
  | 'scroll_frames';

export type MessengerRoomType = 'direct' | 'group';

export type MessengerLatencyAttributes = Record<string, string | number | boolean>;

export type MessengerLatencySample = {
  metric: MessengerLatencyMetric;
  durationMs: number;
  endedAtMs: number;
  attributes: MessengerLatencyAttributes;
};

type MessengerLatencyReporter = (sample: MessengerLatencySample) => void;

const MAX_DURATION_MS = 10 * 60 * 1000;
// 서버 시각과 기기 시각의 차이로 생기는 작은 음수는 0으로 보고, 그보다 크면 버린다.
const CLOCK_SKEW_TOLERANCE_MS = 2_000;
const INTENT_TTL_MS = 3_000;
const LONG_FRAME_MS = 34;
const MIN_SCROLL_SAMPLE_MS = 300;
const SCROLL_END_GRACE_MS = 150;

let reporter: MessengerLatencyReporter | null = null;
const intents = new Map<MessengerLatencyMetric, number>();
const recordedPushIds = new Set<string>();

export const setMessengerLatencyReporter = (next: MessengerLatencyReporter | null): void => {
  reporter = next;
};

export const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const recordMessengerLatency = (
  metric: MessengerLatencyMetric,
  durationMs: number,
  attributes: MessengerLatencyAttributes = {},
): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_DURATION_MS) return;
  const sample: MessengerLatencySample = {
    metric,
    durationMs: Math.round(durationMs),
    endedAtMs: Date.now(),
    attributes,
  };
  logger.debug('[messenger-latency]', sample);
  try {
    reporter?.(sample);
  } catch {
    // 측정 실패가 메신저 동작을 막으면 안 된다.
  }
};

/** 서버가 기록한 시각부터 기기에서 관측한 시각까지. 기기 시계 오차가 그대로 섞인다. */
export const recordServerToDeviceLatency = (
  metric: MessengerLatencyMetric,
  serverTime: string | number | null | undefined,
  observedAtMs: number,
  attributes: MessengerLatencyAttributes = {},
): void => {
  const serverMs = typeof serverTime === 'number' ? serverTime : Date.parse(String(serverTime ?? ''));
  if (!Number.isFinite(serverMs)) return;
  const raw = observedAtMs - serverMs;
  if (raw < -CLOCK_SKEW_TOLERANCE_MS) return;
  recordMessengerLatency(metric, Math.max(0, raw), { ...attributes, clock: 'server_to_device' });
};

export const measureMessengerLatency = async <T>(
  metric: MessengerLatencyMetric,
  task: () => Promise<T>,
  attributes: MessengerLatencyAttributes = {},
): Promise<T> => {
  const startedAt = monotonicNow();
  try {
    const result = await task();
    recordMessengerLatency(metric, monotonicNow() - startedAt, { ...attributes, outcome: 'ok' });
    return result;
  } catch (error) {
    recordMessengerLatency(metric, monotonicNow() - startedAt, { ...attributes, outcome: 'error' });
    throw error;
  }
};

/** 사용자가 누른 순간을 기록해 두면, 다음 화면의 렌더 측정이 화면 전환 시간까지 포함한다. */
export const markMessengerIntent = (metric: MessengerLatencyMetric): void => {
  intents.set(metric, monotonicNow());
};

const consumeIntent = (metric: MessengerLatencyMetric, mountedAt: number): number | null => {
  const intentAt = intents.get(metric);
  intents.delete(metric);
  if (intentAt === undefined || mountedAt - intentAt > INTENT_TTL_MS || intentAt > mountedAt) {
    return null;
  }
  return intentAt;
};

const requestFrame = (callback: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
};

/**
 * 화면이 처음 그려진 순간(또는 직전 탭)부터 `ready`가 처음 true가 된 뒤의 다음 프레임까지를 한 번 기록한다.
 */
export function useMessengerRenderLatency(
  metric: 'room_list_render' | 'room_render',
  ready: boolean,
  attributes: MessengerLatencyAttributes = {},
): void {
  const startRef = useRef<{ at: number; source: 'tap' | 'mount' } | null>(null);
  if (startRef.current === null) {
    const mountedAt = monotonicNow();
    const intentAt = consumeIntent(metric, mountedAt);
    startRef.current = intentAt === null
      ? { at: mountedAt, source: 'mount' }
      : { at: intentAt, source: 'tap' };
  }
  const recordedRef = useRef(false);
  const attributesRef = useRef(attributes);
  attributesRef.current = attributes;

  useEffect(() => {
    if (!ready || recordedRef.current) return undefined;
    return requestFrame(() => {
      const start = startRef.current;
      if (recordedRef.current || !start) return;
      recordedRef.current = true;
      recordMessengerLatency(metric, monotonicNow() - start.at, {
        ...attributesRef.current,
        start: start.source,
      });
    });
  }, [metric, ready]);
}

/**
 * 열린 대화방에 상대 메시지가 나타난 시각 - 서버 저장 시각.
 * 방을 연 뒤 서버에 저장된 메시지만 센다(열기 전 메시지는 지연이 아니라 기록이다).
 */
export function createPeerDeliveryTracker<T>(options: {
  roomType: MessengerRoomType;
  getId: (message: T) => string;
  getCreatedAt: (message: T) => string | null | undefined;
  isIncoming: (message: T) => boolean;
  openedAtMs?: number;
}) {
  const openedAtMs = options.openedAtMs ?? Date.now();
  const seen = new Set<string>();
  return {
    observe(messages: readonly T[], attributes: MessengerLatencyAttributes = {}) {
      const observedAtMs = Date.now();
      for (const message of messages) {
        const id = options.getId(message);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (!options.isIncoming(message)) continue;
        const createdAtMs = Date.parse(String(options.getCreatedAt(message) ?? ''));
        if (!Number.isFinite(createdAtMs) || createdAtMs < openedAtMs) continue;
        recordServerToDeviceLatency('peer_delivery', createdAtMs, observedAtMs, {
          ...attributes,
          room_type: options.roomType,
        });
      }
    },
  };
}

type PushNotificationLike = {
  date?: number | null;
  request?: {
    identifier?: string | null;
    content?: { data?: Record<string, unknown> | null } | null;
  } | null;
};

const toEpochMs = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
};

/** 서버가 푸시 데이터에 넣은 sentAt부터 기기가 알림을 받은 시각(notification.date)까지. */
export const recordPushDelivery = (
  notification: PushNotificationLike | null | undefined,
  trigger: 'received' | 'opened',
): void => {
  const data = notification?.request?.content?.data;
  if (!data || typeof data.sentAt !== 'string') return;
  const identifier = notification?.request?.identifier ?? '';
  if (identifier) {
    if (recordedPushIds.has(identifier)) return;
    recordedPushIds.add(identifier);
  }
  const deliveredAtMs = toEpochMs(notification?.date) ?? Date.now();
  const kind = typeof data.category === 'string'
    ? data.category
    : typeof data.type === 'string' ? data.type : 'unknown';
  recordServerToDeviceLatency('push_delivery', data.sentAt, deliveredAtMs, { trigger, kind });
};

/** 스크롤 한 번(손가락 시작 ~ 관성 종료)의 프레임 수와 긴 프레임 비율. durationMs는 스크롤 시간이다. */
export function createScrollFrameMonitor(attributes: MessengerLatencyAttributes = {}) {
  let active = false;
  let startedAt = 0;
  let lastFrameAt = 0;
  let frames = 0;
  let longFrames = 0;
  let cancelFrame: (() => void) | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    if (!active) return;
    const at = monotonicNow();
    if (lastFrameAt > 0) {
      frames += 1;
      if (at - lastFrameAt > LONG_FRAME_MS) longFrames += 1;
    }
    lastFrameAt = at;
    cancelFrame = requestFrame(tick);
  };

  const clearEndTimer = () => {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
  };

  const stop = () => {
    clearEndTimer();
    if (!active) return;
    active = false;
    cancelFrame?.();
    cancelFrame = null;
    const durationMs = monotonicNow() - startedAt;
    if (durationMs < MIN_SCROLL_SAMPLE_MS || frames === 0) return;
    recordMessengerLatency('scroll_frames', durationMs, {
      ...attributes,
      fps: Math.round((frames * 1000) / durationMs),
      long_frame_ratio: Math.round((longFrames / frames) * 100) / 100,
    });
  };

  return {
    onScrollBeginDrag: () => {
      clearEndTimer();
      if (active) return;
      active = true;
      startedAt = monotonicNow();
      lastFrameAt = 0;
      frames = 0;
      longFrames = 0;
      cancelFrame = requestFrame(tick);
    },
    onScrollEndDrag: () => {
      clearEndTimer();
      endTimer = setTimeout(stop, SCROLL_END_GRACE_MS);
    },
    onMomentumScrollBegin: clearEndTimer,
    onMomentumScrollEnd: stop,
    dispose: () => {
      clearEndTimer();
      active = false;
      cancelFrame?.();
      cancelFrame = null;
    },
  };
}

export function useScrollFrameMonitor(roomType: MessengerRoomType) {
  const monitor = useMemo(() => createScrollFrameMonitor({ room_type: roomType }), [roomType]);
  useEffect(() => () => monitor.dispose(), [monitor]);
  return monitor;
}

export const resetMessengerLatencyForTests = (): void => {
  reporter = null;
  intents.clear();
  recordedPushIds.clear();
};

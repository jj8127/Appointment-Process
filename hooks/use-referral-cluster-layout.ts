import { useEffect, useMemo, useState } from 'react';
import { InteractionManager } from 'react-native';

import {
  buildMobileClusterPositions, clusterPositionsFromPayload, parseClusterPositions, referralClusterLayoutKey, serializeClusterPositions,
} from '@/lib/referral-graph-cluster-mobile';
import { safeStorage } from '@/lib/safe-storage';
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

type Positions = ReadonlyMap<string, ReferralGraphPoint>;
export type ReferralClusterLayoutState = {
  positions: Positions | null;
  /** 계산(또는 저장본 읽기)에 걸린 시간 ms */
  elapsedMs: number | null;
  source: 'memory' | 'storage' | 'server' | 'computed' | null;
};

const STORAGE_PREFIX = 'referral-cluster-layout:';
// 같은 실행 중에는 다시 계산하지 않는다(키는 사람·연결 구성의 해시이며 이름·금액은 담지 않는다).
const memory = new Map<string, Positions>();

/**
 * 관리자 웹과 같은 집단 배치 좌표를 구하고 기억한다.
 * 순서: 이번 실행에서 기억한 것 → 폰에 저장된 것 → 서버가 계산한 것 → (없거나 실패하면) 폰에서 직접 계산.
 * 직접 계산은 화면이 먼저 "배치 중"을 그린 뒤 시작한다.
 */
export function useReferralClusterLayout(
  nodes: readonly ReferralGraphNode[],
  edges: readonly ReferralGraphEdge[],
  enabled: boolean,
  loadServerLayout?: () => Promise<unknown>,
) {
  const key = useMemo(() => (enabled && nodes.length ? referralClusterLayoutKey(nodes, edges) : null), [enabled, nodes, edges]);
  const [state, setState] = useState<{ key: string | null } & ReferralClusterLayoutState>(
    { key: null, positions: null, elapsedMs: null, source: null });

  useEffect(() => {
    if (!key) return;
    const cached = memory.get(key);
    if (cached) { setState({ key, positions: cached, elapsedMs: 0, source: 'memory' }); return; }
    let cancelled = false;
    const started = Date.now();
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const stored = parseClusterPositions(await safeStorage.getItem(STORAGE_PREFIX + key).catch(() => null), nodes);
        if (cancelled) return;
        if (stored) {
          memory.set(key, stored);
          setState({ key, positions: stored, elapsedMs: Date.now() - started, source: 'storage' });
          return;
        }
        const fromServer = loadServerLayout
          ? clusterPositionsFromPayload(await loadServerLayout().catch(() => null), nodes) : null;
        if (cancelled) return;
        if (fromServer) {
          memory.set(key, fromServer);
          void safeStorage.setItem(STORAGE_PREFIX + key, serializeClusterPositions(fromServer)).catch(() => undefined);
          setState({ key, positions: fromServer, elapsedMs: Date.now() - started, source: 'server' });
          return;
        }
        // 다음 프레임에 계산해 "배치 중" 표시가 먼저 보이게 한다
        setTimeout(() => {
          if (cancelled) return;
          const computeStarted = Date.now();
          const positions = buildMobileClusterPositions(nodes, edges);
          const elapsedMs = Date.now() - computeStarted;
          memory.set(key, positions);
          void safeStorage.setItem(STORAGE_PREFIX + key, serializeClusterPositions(positions)).catch(() => undefined);
          if (!cancelled) setState({ key, positions, elapsedMs, source: 'computed' });
        }, 16);
      })();
    });
    return () => { cancelled = true; task.cancel(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 같은 조직(key)이면 서버 요청 함수가 바뀌어도 다시 구하지 않는다
  }, [key, nodes, edges]);

  const current = state.key === key ? state : null;
  return {
    positions: current?.positions ?? null,
    elapsedMs: current?.elapsedMs ?? null,
    source: current?.source ?? null,
    computing: Boolean(key) && !current?.positions,
  };
}

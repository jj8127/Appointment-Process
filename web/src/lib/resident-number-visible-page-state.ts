import type { ResidentNumberReadResult } from '@/lib/resident-number-client';
import type { DashboardResidentNumberCell } from '@/lib/dashboard-table-display';

export type ResidentNumberCellMap = Record<string, DashboardResidentNumberCell>;

export type VisiblePageResidentNumberScope = {
  key: string;
  fcIds: string[];
  initialCells: ResidentNumberCellMap;
  shouldFetch: boolean;
};

export type ResolvedVisiblePageResidentNumbers = {
  scopeKey: string;
  cells: ResidentNumberCellMap;
};

const createCellMap = (
  fcIds: string[],
  createCell: (fcId: string) => DashboardResidentNumberCell,
): ResidentNumberCellMap =>
  Object.fromEntries(fcIds.map((fcId) => [fcId, createCell(fcId)]));

export function createVisiblePageResidentNumberScope(options: {
  fcIds: string[];
  enabled: boolean;
  resetKey: string;
}): VisiblePageResidentNumberScope {
  const fcIds = Array.from(
    new Set(options.fcIds.map((fcId) => fcId.trim()).filter(Boolean)),
  );
  const shouldFetch = options.enabled && fcIds.length > 0 && fcIds.length <= 20;
  const initialCells = !options.enabled || fcIds.length === 0
    ? {}
    : createCellMap(
        fcIds,
        () => ({ status: fcIds.length > 20 ? 'error' : 'loading' }),
      );

  return {
    key: [
      options.enabled ? 'enabled' : 'disabled',
      options.resetKey,
      fcIds.join('\u001f'),
    ].join('\u001e'),
    fcIds,
    initialCells,
    shouldFetch,
  };
}

export function resolveVisiblePageResidentNumbers(
  scope: VisiblePageResidentNumberScope,
  result: ResidentNumberReadResult,
): ResolvedVisiblePageResidentNumbers {
  return {
    scopeKey: scope.key,
    cells: createCellMap(scope.fcIds, (fcId) => {
      const value = result.residentNumbers[fcId];
      const status = result.residentNumberStatuses[fcId];
      if (status === 'ready' && value) {
        return { status: 'ready', value };
      }
      if (status === 'missing') {
        return { status: 'missing' };
      }
      return { status: 'unavailable' };
    }),
  };
}

export function failVisiblePageResidentNumbers(
  scope: VisiblePageResidentNumberScope,
): ResolvedVisiblePageResidentNumbers {
  return {
    scopeKey: scope.key,
    cells: createCellMap(scope.fcIds, () => ({ status: 'error' })),
  };
}

export function selectVisiblePageResidentNumberCells(
  scope: VisiblePageResidentNumberScope,
  resolved: ResolvedVisiblePageResidentNumbers,
): ResidentNumberCellMap {
  return resolved.scopeKey === scope.key ? resolved.cells : scope.initialCells;
}

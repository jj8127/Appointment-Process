'use client';

import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/hooks/use-session';
import { fetchResidentNumberFull } from '@/lib/resident-number-client';

function getBirthDate(residentNumber?: string | null) {
  const digits = String(residentNumber ?? '').replace(/\D/g, '');
  if (digits.length < 6) return '-';
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
}

type UseResidentNumberOptions = {
  fcId?: string | null;
  enabled?: boolean;
};

export function useResidentNumber({ fcId, enabled = true }: UseResidentNumberOptions) {
  const { hydrated, role, residentId } = useSession();
  const canReadResidentNumber = role === 'admin' || role === 'manager';

  const query = useQuery({
    queryKey: ['resident-number', fcId, role, residentId],
    enabled: hydrated && enabled && canReadResidentNumber && Boolean(fcId),
    refetchOnMount: 'always',
    retry: 1,
    queryFn: async () => {
      if (!fcId) return null;
      return fetchResidentNumberFull(fcId);
    },
  });

  return {
    ...query,
    canReadResidentNumber,
    residentNumber: query.data ?? null,
    residentNumberDisplay: query.isFetching
      ? '주민번호 조회 중...'
      : (query.data ?? (query.error instanceof Error ? query.error.message : '주민번호 조회 실패')),
    birthDateDisplay: getBirthDate(query.data ?? null),
  };
}

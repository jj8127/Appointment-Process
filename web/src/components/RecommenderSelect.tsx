'use client';

import { Select, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';

import type { RecommenderCandidate } from '@/types/referrals';
import { QueryErrorAlert } from '@/components/QueryErrorAlert';
import { QueryReadError } from '@/lib/query-read-error';

type SearchRecommendersResponse = {
  ok: true;
  candidates: RecommenderCandidate[];
  selectedCandidate: RecommenderCandidate | null;
};

type RecommenderSelectProps = {
  label?: string;
  value: string | null;
  inviteeFcId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onChange: (candidate: RecommenderCandidate | null) => void;
};

function buildOptionLabel(candidate: RecommenderCandidate) {
  return [candidate.name, candidate.descriptor, candidate.activeCode].filter(Boolean).join(' · ');
}

export function RecommenderSelect(props: RecommenderSelectProps) {
  const [searchValue, setSearchValue] = useState('');
  const deferredSearch = useDeferredValue(searchValue);

  const query = useQuery({
    queryKey: ['recommender-candidates', deferredSearch, props.inviteeFcId ?? null, props.value ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({
        query: deferredSearch,
        inviteeFcId: props.inviteeFcId ?? '',
        selectedFcId: props.value ?? '',
      });
      const response = await fetch(`/api/admin/fc/recommender?${params.toString()}`, {
        credentials: 'include',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new QueryReadError(response.status);
      }
      if (!data || typeof data !== 'object' || !('candidates' in data) || !Array.isArray(data.candidates)) {
        throw new QueryReadError();
      }
      return data as SearchRecommendersResponse;
    },
    enabled: !props.disabled,
  });

  const candidates = useMemo(() => {
    const list = query.data?.candidates ?? [];
    const selectedCandidate = query.data?.selectedCandidate ?? null;
    return selectedCandidate && !list.some((candidate) => candidate.fcId === selectedCandidate.fcId)
      ? [selectedCandidate, ...list]
      : list;
  }, [query.data]);

  const options = useMemo(
    () => candidates.map((candidate) => ({ value: candidate.fcId, label: buildOptionLabel(candidate) })),
    [candidates],
  );

  const selectedCandidate = candidates.find((candidate) => candidate.fcId === props.value) ?? null;

  return (
    <Stack gap={4}>
      <Select
        label={props.label ?? '추천인'}
        placeholder={props.placeholder ?? '이름, 소속, 코드로 검색'}
        searchable
        clearable
        value={props.value}
        data={options}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onChange={(nextValue) => {
          const nextCandidate = candidates.find((candidate) => candidate.fcId === nextValue) ?? null;
          props.onChange(nextCandidate);
        }}
        disabled={props.disabled}
        nothingFoundMessage={query.isFetching ? '후보를 불러오는 중입니다.' : query.isError ? '후보를 불러오지 못했습니다.' : '검색 결과가 없습니다.'}
      />
      {query.isError && (
        <QueryErrorAlert error={query.error} onRetry={query.refetch} isFetching={query.isFetching} hasData={!!query.data} subject="추천인 후보" />
      )}
      {selectedCandidate ? (
        <Text size="xs" c="dimmed">
          선택됨: {selectedCandidate.label}
          {selectedCandidate.activeCode ? ` · ${selectedCandidate.activeCode}` : ''}
        </Text>
      ) : null}
    </Stack>
  );
}

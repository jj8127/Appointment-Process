'use client';

import { Select } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { fetchAdminFcList, isAdminFcProfile } from '@/lib/admin-document-client';
import { searchFcRows } from '@/lib/fc-global-search';

type GlobalFcSearchProps = { role: string | null; residentId: string };

export function GlobalFcSearch({ role, residentId }: GlobalFcSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false);
  const [search, setSearch] = useState('');
  useHotkeys([['mod+K', () => inputRef.current?.focus()]]);

  // Same key and reader as the dashboard list, so the cache is shared.
  const { data: fcs, isFetching, isError } = useQuery({
    queryKey: ['dashboard-list', role, residentId],
    queryFn: () => fetchAdminFcList(isAdminFcProfile),
    enabled: armed && (role === 'admin' || role === 'manager'),
  });

  const options = searchFcRows(fcs ?? [], search).map((fc) => ({
    value: fc.id,
    label: `${fc.name} · ${fc.affiliation || '소속 미정'} · ${fc.phone.slice(-4)}`,
  }));

  return (
    <Select
      ref={inputRef}
      aria-label="FC 검색"
      placeholder="FC 이름·연락처 검색 (Ctrl+K)"
      leftSection={<IconSearch size={16} stroke={2} />}
      searchable
      clearable
      value={null}
      searchValue={search}
      onSearchChange={setSearch}
      onFocus={() => setArmed(true)}
      data={options}
      filter={({ options: filtered }) => filtered}
      nothingFoundMessage={
        !search.trim() ? null : isError ? 'FC 목록을 불러오지 못했습니다.' : isFetching && !fcs ? '불러오는 중' : '검색 결과 없음'
      }
      onChange={(fcId) => {
        if (!fcId) return;
        setSearch('');
        inputRef.current?.blur();
        router.push(`/dashboard/profile/${encodeURIComponent(fcId)}`);
      }}
      radius="xl"
      w={300}
      visibleFrom="sm"
      comboboxProps={{ zIndex: 400 }}
    />
  );
}

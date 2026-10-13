/* global describe, it, expect */
const { readFileSync } = require('node:fs');

const read = (path) => readFileSync(path, 'utf8');

describe('mobile administrative read contracts', () => {
  it('paginates and validates the dashboard FC collection', () => {
    const source = read('app/dashboard.tsx');
    const fetchFcs = source.slice(
      source.indexOf('const fetchFcs = async'),
      source.indexOf('export default function DashboardScreen'),
    );

    expect(fetchFcs).toContain('collectSupabaseRows<FcRow>');
    expect(fetchFcs).toContain(".order('id', { ascending: true })");
    expect(fetchFcs).toContain('.range(from, to)');
    expect(fetchFcs).toContain('isRow: isFcRow');
    expect(fetchFcs).not.toContain('return data as FcRow[]');
    expect(source).toContain("from '@/supabase/functions/_shared/direct-message-search'");
    expect(fetchFcs).toContain('escapePostgrestLikeLiteral(keyword)');
    expect(fetchFcs).toContain('const searchPattern = `"*${escapedKeyword}*"`;');
    expect(fetchFcs).not.toContain('`name.ilike.%${keyword}%');
  });

  it('keeps a failed messenger list read distinct from an empty result and exposes retry', () => {
    const source = read('app/admin-messenger.tsx');

    expect(source).toContain("from '@/components/QueryReadState'");
    expect(source).toContain('error: chatListError');
    expect(source).toContain('isError && !data');
    expect(source).toContain('message="대화 목록을 불러오지 못했습니다."');
    expect(source).toContain('retrying={isFetching}');
    expect(source).toContain('기존 목록을 표시합니다.');
  });

  it('uses the existing cursor contract to expose every administrative conversation', () => {
    const source = read('app/admin-messenger.tsx');
    const api = read('lib/internal-chat-api.ts');

    expect(source).toContain("import { useInfiniteQuery } from '@tanstack/react-query'");
    expect(source).toContain('fetchInternalChatListPage(viewerContext, cursor, CHAT_LIST_PAGE_SIZE)');
    expect(source).toContain('getNextPageParam: (lastPage) => lastPage.hasMore');
    expect(source).toContain('for (const page of data?.pages ?? [])');
    expect(source).toContain('accessibilityLabel="이전 대화 목록 더 보기"');
    expect(source).toContain('onPress={() => void fetchNextPage()}');
    expect(source).not.toContain('fetchInternalChatList(viewerContext)');
    expect(api).toContain('const page = await fetchInternalChatListPage(input, cursor, 50)');
    expect(api).toContain('while (cursor);');
    expect(api).toContain("throw new Error('internal chat list pagination did not advance')");
  });

  it('batches every requested presence phone through the shared response contract', () => {
    const source = read('lib/user-presence-api.ts');

    expect(source).toContain("from './presence-read-response'");
    expect(source).toContain('collectPresenceSnapshotBatches(phones');
    expect(source).toContain('phones: phoneBatch');
    expect(source).not.toContain(').slice(0, 100)');
  });

  it('paginates counts and exam statistics while requiring the signed-in FC row', () => {
    const source = read('app/index.tsx');

    expect(source).toContain("queryName: 'mobile_home_fc_counts'");
    expect(source).toContain("requireSupabaseRowMatching(data, 'mobile_home_fc_status'");
    expect(source).toContain('collectSupabaseRows<ExamStatsRegistrationRow>');
    expect(source).toContain('buildExamPhoneCandidates');
    expect(source).toContain('chunkSupabaseFilterValues(profileLookupCandidates)');
    expect(source).toContain('profileIdByPhoneCandidate');
    expect(source).toContain('latestByProfile');
    expect(source).not.toContain('const normalizeSingle =');
    expect(source).not.toContain('data ?? []');
  });

  it.each(['app/exam-manage.tsx', 'app/exam-manage2.tsx'])(
    'paginates and validates applicant and profile collections in %s',
    (path) => {
      const source = read(path);
      expect(source).toContain('collectSupabaseRows<ExamAdminRegistrationRow>');
      expect(source).toContain('chunkSupabaseFilterValues(profileLookupCandidates)');
      expect(source).toContain('collectSupabaseRows<ExamAdminFcProfileRow>');
      expect(source).toContain('invokeAdminAction(');
      expect(source).toContain('parseResidentNumberEntries(residentResult, fcIds)');
      expect(source).toContain('buildUnavailableResidentNumberEntries(fcIds)');
      expect(source).toContain("residentNumberEntry?.status === 'success'");
      expect(source).toContain("residentNumberEntry.value ?? '미등록'");
      expect(source).toContain("'조회 실패'");
      expect(source).not.toContain('resident_number_read_unavailable');
      expect(source).not.toContain('resident_number_read_incomplete');
      expect(source).not.toContain("supabase.functions.invoke('admin-action'");
      expect(source).not.toContain('residentNumbersByFcId');
      expect(source).not.toContain('주민번호 조회 실패');
      expect(source).not.toContain('const rows = (data ?? [])');
      expect(source).not.toContain('(profiles ?? [])');
    },
  );
});

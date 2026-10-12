import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { informationStyles } from '@/components/ServiceInformation';
import { getSeoulTodayIsoDate } from '@/lib/admin-assisted-signup-validation';
import { parseCalendarDate } from '@/lib/calendar-date';
import { PlatformApiError, platformRequest, type PlatformHospitalReport as Report } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

const METRICS = { impressions: '광고 노출', detailViews: '상세 열람', phoneClicks: '전화 클릭', directionsClicks: '길찾기 클릭' } as const;
const PLACEMENTS = { regional_list: '지역 목록', regional_featured: '지역 강조' } as const;

export default function HospitalPerformanceReport({ token, allowed, partners }: {
  token: string | null; allowed: boolean; partners: { id: string; name: string }[];
}) {
  const today = getSeoulTodayIsoDate();
  const [partnerId, setPartnerId] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<{ key: string; report: Report } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const beginRead = useReadAttempt();
  const queryKey = JSON.stringify([token, allowed, partnerId, from, to]);
  const owner = useRef(queryKey); owner.current = queryKey;
  const report = data?.key === queryKey ? data.report : null;

  useEffect(() => {
    beginRead(); pending.current = false; setLoading(false); setError(null);
  }, [queryKey, beginRead]);
  useEffect(() => { setData(null); setPartnerId(''); }, [token, allowed]);

  const load = async () => {
    if (!allowed || !token || pending.current) return;
    if (!parseCalendarDate(from) || !parseCalendarDate(to) || from > to || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 92) {
      setError('시작일과 종료일을 YYYY-MM-DD로 입력해 주세요. 최대 93일을 조회할 수 있습니다.'); return;
    }
    pending.current = true; setLoading(true); setError(null);
    const owns = beginRead();
    try {
      const next = await platformRequest<Report>('get_hospital_report', { ...(partnerId ? { partnerId } : {}), from, to }, token);
      if (owns() && owner.current === queryKey) setData({ key: queryKey, report: next });
    } catch (cause) {
      if (!owns() || owner.current !== queryKey) return;
      if (cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403)) setData(null);
      setError(cause instanceof Error ? cause.message : '성과를 조회하지 못했습니다. 같은 조건의 기존 결과를 유지했습니다.');
    } finally {
      if (owns() && owner.current === queryKey) { pending.current = false; setLoading(false); }
    }
  };

  if (!allowed) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={informationStyles.sectionTitle}>병원 광고 성과</Text>
    <Text style={styles.note}>최근 90일 · 한국 날짜 기준</Text>
    <View style={styles.choices}>
      <Button size="sm" variant={!partnerId ? 'primary' : 'outline'} disabled={loading} onPress={() => setPartnerId('')}>전체 병원</Button>
      {partners.map((partner) => <Button key={partner.id} size="sm" variant={partnerId === partner.id ? 'primary' : 'outline'} disabled={loading} onPress={() => setPartnerId(partner.id)}>{partner.name}</Button>)}
    </View>
    <FormInput label="조회 시작일 (YYYY-MM-DD)" accessibilityLabel="성과 조회 시작일" value={from} editable={!loading} maxLength={10} onChangeText={setFrom} />
    <FormInput label="조회 종료일 (YYYY-MM-DD)" accessibilityLabel="성과 조회 종료일" value={to} editable={!loading} maxLength={10} onChangeText={setTo} />
    <Button fullWidth loading={loading} disabled={!token} onPress={() => void load()}>광고 성과 조회</Button>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {report && <>
      <Text style={styles.period}>{from} ~ {to} · 한국 날짜</Text>
      <View style={styles.metrics}>
        {Object.entries(METRICS).map(([key, label]) => <View key={key} style={styles.metric}>
          <Text style={styles.metricValue}>{report.totals[key as keyof typeof METRICS].toLocaleString('ko-KR')}</Text>
          <Text style={styles.metricLabel}>{label}</Text>
        </View>)}
      </View>
      {report.rows.length === 0 ? <Text style={styles.note}>이 조건에서 집계된 광고 이벤트가 없습니다.</Text> : <>
        <Text style={styles.breakdownTitle}>날짜·지면별 집계</Text>
        {report.rows.map((row) => <View key={`${row.partnerId}:${row.date}:${row.placement}:${row.revision}`} style={styles.row}>
          <Text style={styles.rowTitle}>{row.name}</Text>
          <Text style={styles.note}>{row.date} · {PLACEMENTS[row.placement]} · {row.revision === 0 ? '최초 등록' : `계약 수정 ${row.revision}차`}</Text>
          <Text style={styles.rowCounts}>노출 {row.impressions.toLocaleString('ko-KR')} · 상세 {row.detailViews.toLocaleString('ko-KR')} · 전화 {row.phoneClicks.toLocaleString('ko-KR')} · 길찾기 {row.directionsClicks.toLocaleString('ko-KR')}</Text>
        </View>)}
      </>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 24, marginBottom: 24, paddingTop: 24, borderTopWidth: 1, borderColor: COLORS.border.light },
  note: { fontSize: 13, lineHeight: 21, color: COLORS.text.secondary, marginBottom: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  error: { fontSize: 14, lineHeight: 23, color: COLORS.error, marginTop: 12 },
  period: { fontSize: 13, color: COLORS.text.secondary, marginVertical: 16 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  metric: { width: '46%', backgroundColor: COLORS.background.secondary, padding: 16, borderRadius: 14 },
  metricValue: { color: COLORS.text.primary, fontSize: 24, fontWeight: '700', marginBottom: 6 },
  metricLabel: { color: COLORS.text.secondary, fontSize: 13 },
  breakdownTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text.primary, marginBottom: 12 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderColor: COLORS.border.light },
  rowTitle: { fontSize: 14, color: COLORS.text.primary, fontWeight: '600', marginBottom: 6 },
  rowCounts: { fontSize: 13, lineHeight: 21, color: COLORS.text.secondary },
});

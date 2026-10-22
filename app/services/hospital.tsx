import { MaterialIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import HospitalScreen, { IconTile, hospitalStyles as styles } from '@/components/hospitals/HospitalScreen';
import { recordHospitalEvent, useHospitalExposure } from '@/hooks/use-hospital-exposure';
import { formatExternalUrlDisplayText } from '@/lib/external-url';
import { openExternalUrl } from '@/lib/open-external-url';
import { PlatformApiError, acceptsCareRequests, isSampleHospital, platformRequest, type PlatformHospital } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

const TIME_RANGE = String.raw`\d{1,2}:\d{2}\s*[–~-]\s*\d{1,2}:\d{2}`;
const HOURS_PART = new RegExp(String.raw`^(.+?)\s+(${TIME_RANGE})(?:\s*\((.+?)\s+(${TIME_RANGE})\))?$`);

/** Splits the approved "평일 09:00–20:00 (점심 13:00–14:00) · … · 365일 진료" text into rows; parts without a time become tags. */
function splitOpeningHours(text: string | null | undefined) {
  if (!text) return null;
  const rows: [string, string][] = [];
  const tags: string[] = [];
  for (const part of text.split(' · ')) {
    const match = part.trim().match(HOURS_PART);
    if (!match) { tags.push(part.trim()); continue; }
    rows.push([match[1], match[2]]);
    if (match[3] && match[4]) rows.push([match[3], match[4]]);
  }
  return rows.length ? { rows, tags } : null;
}

export default function HospitalDetail() {
  const { id, placement } = useLocalSearchParams<{ id?: string; placement?: string }>();
  const begin = useReadAttempt();
  const [hospital, setHospital] = useState<PlatformHospital | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = useMemo(() => hospital && hospital.id === id ? { ...hospital, adPlacement: hospital.adPlacement === 'regional_featured' && placement === 'regional_featured' ? 'regional_featured' as const : 'regional_list' as const } : null, [hospital, id, placement]);
  const measured = useMemo(() => shown ? [shown] : [], [shown]);
  const sessionId = useHospitalExposure(measured, 'detail');
  const hours = useMemo(() => splitOpeningHours(shown?.openingHours), [shown?.openingHours]);
  const refresh = useCallback(async () => {
    const owns = begin();
    if (!id) { setError('병원 정보를 확인할 수 없습니다. 목록에서 다시 선택해 주세요.'); setHospital(null); return; }
    setLoading(true); setError(null);
    try {
      const response = await platformRequest<{ hospital: PlatformHospital }>('get_hospital', { hospitalId: id });
      if (owns()) setHospital(response.hospital);
    } catch (cause) {
      if (!owns()) return;
      if (cause instanceof PlatformApiError && cause.code === 'hospital_not_found') setHospital(null);
      setError(cause instanceof Error ? cause.message : '병원 정보를 불러오지 못했습니다.');
    } finally { if (owns()) setLoading(false); }
  }, [begin, id]);
  useEffect(() => { setActionError(null); void refresh(); }, [refresh]);
  const failed = () => setActionError('연결할 앱을 열지 못했습니다. 아래 주소나 전화번호를 확인해 주세요.');
  const open = (url: string, eventType?: 'phone') => {
    setActionError(null);
    if (shown && eventType) recordHospitalEvent(shown, eventType, sessionId);
    void openExternalUrl(url, { preferExternalBrowser: true }).catch(failed);
  };
  // Naver Map app first; its web page (which offers the app) when the app is missing.
  const directions = async (target: PlatformHospital) => {
    setActionError(null);
    recordHospitalEvent(target, 'directions', sessionId);
    const query = encodeURIComponent(`${target.name} ${target.address}`);
    if (Platform.OS !== 'web') {
      try { await openExternalUrl(`nmap://search?query=${query}&appname=${Application.applicationId ?? 'moduon'}`); return; } catch { /* App not installed. */ }
    }
    await openExternalUrl(`https://map.naver.com/p/search/${query}`, { preferExternalBrowser: true }).catch(failed);
  };
  const sample = shown ? isSampleHospital(shown.id) : false;

  return <HospitalScreen detail overlayHeader={!!shown?.photoUrl}
    footer={shown && acceptsCareRequests(shown.id) ? <Button size="lg" style={local.cta} textStyle={local.ctaText}
      onPress={() => router.push({ pathname: '/services/care-request', params: { hospitalId: shown.id } })}
      leftIcon={<MaterialIcons name="calendar-month" size={22} color={COLORS.white} accessible={false} />}>간병 예약 요청하기</Button> : undefined}>
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      {loading && !shown && <View style={[styles.content, styles.row]}><ActivityIndicator color={COLORS.primary} /><Text style={styles.body}>병원 정보를 확인하고 있어요.</Text></View>}
      {error && <View style={[styles.content, shown?.photoUrl && local.belowBack]}><View style={styles.error}><Text accessibilityRole="alert" style={styles.body}>{error}</Text>{shown && <Text style={styles.caption}>최근 조회한 정보를 표시하고 있습니다.</Text>}<Button variant="outline" loading={loading} onPress={() => void refresh()}>다시 확인하기</Button></View></View>}
      {shown && <>
        {shown.photoUrl && <Image source={{ uri: shown.photoUrl }} accessibilityLabel={`${shown.name} 병원 사진`} style={local.photo} />}
        <View style={local.intro}>
          <Text style={styles.ad}>{sample ? '샘플' : '병원 제공 광고'}</Text>
          <Text accessibilityRole="header" style={styles.title}>{shown.name}</Text>
          <View style={local.meta}>
            <Text style={local.metaText}>{[...shown.specialties, shown.region].filter(Boolean).join(' · ')}</Text>
            {hours?.tags.map((tag) => <Text key={tag} style={local.tag}>{tag}</Text>)}
          </View>
          {(shown.phone || shown.address) && <View style={local.actions}>
            {shown.phone && <Button variant="ghost" style={local.action} textStyle={local.actionText} leftIcon={<IconTile name="call" tone="green" />}
              onPress={() => open(`tel:${shown.phone!.replace(/[^0-9+]/g, '')}`, 'phone')}>전화 문의</Button>}
            {shown.address && <Button variant="ghost" disabled={sample} style={local.action} textStyle={local.actionText} leftIcon={<IconTile name="directions" tone="blue" />}
              onPress={() => void directions(shown)}>위치·길찾기</Button>}
          </View>}
          {actionError && <Text accessibilityRole="alert" style={styles.body}>{actionError}</Text>}
        </View>
        <View style={styles.band} />
        <View style={local.info}>
          <View style={local.infoRow}><IconTile name="location-on" tone="blue" size={34} />
            {shown.address ? <Text selectable style={local.infoText}>{shown.address}</Text> : <Text style={[local.infoText, local.muted]}>주소 정보를 확인 중입니다.</Text>}</View>
          <View style={[local.infoRow, local.divided]}><IconTile name="schedule" tone="violet" size={34} />
            {hours ? <View style={local.hours}>{hours.rows.map(([label, time]) => <View key={label} style={styles.row}>
              <Text style={local.hoursLabel}>{label}</Text><Text style={local.infoText}>{time}</Text></View>)}</View>
              : <Text style={local.infoText}>{shown.openingHours || '운영시간 미등록'}</Text>}</View>
          {shown.phone && <View style={[local.infoRow, local.divided]}><IconTile name="call" tone="green" size={34} /><Text selectable style={local.infoText}>{shown.phone}</Text></View>}
          {shown.websiteUrl && <Pressable accessibilityRole="link" accessibilityLabel="병원 홈페이지 열기" onPress={() => open(shown.websiteUrl!)}
            style={({ pressed }) => [local.infoRow, local.divided, pressed && { opacity: 0.6 }]}>
            <IconTile name="language" tone="slate" size={34} /><Text style={[local.infoText, local.link]}>{formatExternalUrlDisplayText(shown.websiteUrl)}</Text>
          </Pressable>}
        </View>
        {shown.description && <>
          <View style={styles.band} />
          <View style={[styles.content, { gap: 10 }]}><Text accessibilityRole="header" style={styles.heading}>병원 소개</Text><Text style={styles.body}>{shown.description}</Text></View>
        </>}
        <View style={local.verified}>
          {shown.verifiedAt && <Text style={[styles.caption, styles.flexible]}>정보 확인일 {shown.verifiedAt.slice(0, 10).replace(/-/g, '.')}</Text>}
          <Button variant="ghost" size="sm" loading={loading} onPress={() => void refresh()} textStyle={local.recheck}>정보 다시 확인</Button>
        </View>
      </>}
    </ScrollView>
  </HospitalScreen>;
}

const local = StyleSheet.create({
  photo: { width: '100%', height: 270, backgroundColor: COLORS.gray[100] },
  belowBack: { paddingTop: 64 },
  intro: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20, gap: 10 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 16, lineHeight: 24, color: COLORS.text.secondary },
  tag: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: COLORS.tile.green.fg, backgroundColor: COLORS.tile.green.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  action: { flex: 1, minHeight: 68, borderRadius: 16, backgroundColor: COLORS.gray[50], paddingHorizontal: 12 },
  actionText: { fontSize: 16, fontWeight: '700', color: COLORS.text.primary },
  info: { paddingHorizontal: 20, paddingVertical: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14 },
  divided: { borderTopWidth: 1, borderTopColor: COLORS.gray[100] },
  infoText: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 24, color: COLORS.text.primary, paddingTop: 5 },
  muted: { color: COLORS.text.secondary },
  link: { color: COLORS.tile.blue.fg, fontWeight: '600' },
  hours: { flex: 1, minWidth: 0, gap: 2 },
  hoursLabel: { minWidth: 84, fontSize: 16, lineHeight: 24, color: COLORS.gray[500], paddingTop: 5 },
  verified: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4 },
  recheck: { fontSize: 14, color: COLORS.primaryDark },
  cta: { borderRadius: 16 },
  ctaText: { fontSize: 17, fontWeight: '700' },
});

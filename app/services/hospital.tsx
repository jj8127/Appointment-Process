import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import HospitalScreen, { hospitalStyles as styles } from '@/components/hospitals/HospitalScreen';
import { recordHospitalEvent, useHospitalExposure } from '@/hooks/use-hospital-exposure';
import { openExternalUrl } from '@/lib/open-external-url';
import { PlatformApiError, acceptsCareRequests, isSampleHospital, platformRequest, type PlatformHospital } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

export default function HospitalDetail() {
  const { id, placement } = useLocalSearchParams<{ id?: string; placement?: string }>();
  const insets = useSafeAreaInsets();
  const begin = useReadAttempt();
  const [hospital, setHospital] = useState<PlatformHospital | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = useMemo(() => hospital && hospital.id === id ? { ...hospital, adPlacement: hospital.adPlacement === 'regional_featured' && placement === 'regional_featured' ? 'regional_featured' as const : 'regional_list' as const } : null, [hospital, id, placement]);
  const measured = useMemo(() => shown ? [shown] : [], [shown]);
  const sessionId = useHospitalExposure(measured, 'detail');
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
  const open = (url: string, eventType?: 'phone' | 'directions') => {
    setActionError(null);
    if (shown && eventType) recordHospitalEvent(shown, eventType, sessionId);
    void openExternalUrl(url, { preferExternalBrowser: true }).catch(() => setActionError('연결할 앱을 열지 못했습니다. 아래 주소나 전화번호를 확인해 주세요.'));
  };
  return <HospitalScreen detail>
    <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
      {loading && <View style={[styles.content, styles.row]}><ActivityIndicator color={COLORS.primary} /><Text style={styles.body}>병원 정보를 확인하고 있어요.</Text></View>}
      {error && <View style={styles.content}><View style={styles.error}><Text accessibilityRole="alert" style={styles.body}>{error}</Text>{shown && <Text style={styles.caption}>최근 조회한 정보를 표시하고 있습니다.</Text>}<Button variant="outline" loading={loading} onPress={() => void refresh()}>다시 확인하기</Button></View></View>}
      {shown && <>
        {shown.photoUrl ? <Image source={{ uri: shown.photoUrl }} accessibilityLabel={`${shown.name} 병원 사진`} style={{ width: '100%', aspectRatio: 1.7 }} /> : <View style={{ backgroundColor: COLORS.gray[50], padding: 32, alignItems: 'center', gap: 8 }}><Feather name="image" size={36} color={COLORS.gray[400]} accessible={false} /><Text style={styles.caption}>병원 사진</Text></View>}
        <View style={styles.content}>
          <View style={[styles.separator, { gap: 9 }]}>
            <Text style={styles.ad}>{isSampleHospital(shown.id) ? '샘플' : '광고 · 제휴병원'}</Text>
            <Text accessibilityRole="header" style={styles.title}>{shown.name}</Text>
            {!!shown.specialties.length && <Text style={styles.body}>{shown.specialties.join(' · ')}</Text>}
            <Text style={styles.body}>{shown.region}</Text>
          </View>
          {acceptsCareRequests(shown.id) && <View style={[styles.separator, { gap: 12 }]}>
            <Text accessibilityRole="header" style={styles.heading}>간병 예약</Text>
            <Button onPress={() => router.push({ pathname: '/services/care-request', params: { hospitalId: shown.id } })}
              leftIcon={<Feather name="calendar" size={17} color={COLORS.white} accessible={false} />}>간병 예약 요청하기</Button>
          </View>}
          {shown.description && <View style={[styles.separator, { gap: 9 }]}><Text accessibilityRole="header" style={styles.heading}>병원 소개</Text><Text style={styles.body}>{shown.description}</Text></View>}
          <View style={[styles.separator, { gap: 12 }]}>
            <Text accessibilityRole="header" style={styles.heading}>위치와 연락처</Text>
            {shown.address ? <View style={styles.row}><Feather name="map-pin" size={18} color={COLORS.text.secondary} accessible={false} /><Text selectable style={[styles.body, styles.flexible]}>{shown.address}</Text></View> : <Text style={styles.body}>주소 정보를 확인 중입니다.</Text>}
            {shown.phone && <View style={styles.row}><Feather name="phone" size={18} color={COLORS.text.secondary} accessible={false} /><Text selectable style={styles.body}>{shown.phone}</Text></View>}
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {shown.phone && <Button style={{ flexGrow: 1 }} onPress={() => open(`tel:${shown.phone!.replace(/[^0-9+]/g, '')}`, 'phone')} leftIcon={<Feather name="phone" size={17} color={COLORS.white} accessible={false} />}>전화 문의</Button>}
              {shown.address && <Button variant="outline" disabled={isSampleHospital(shown.id)} style={{ flexGrow: 1 }} onPress={() => open(`https://map.naver.com/p/search/${encodeURIComponent(`${shown.name} ${shown.address}`)}`, 'directions')}>위치·길찾기</Button>}
            </View>
            {shown.websiteUrl && <Button variant="ghost" onPress={() => open(shown.websiteUrl!)}>병원 홈페이지 열기 ↗</Button>}
            {actionError && <Text accessibilityRole="alert" style={styles.body}>{actionError}</Text>}
          </View>
          <View style={[styles.separator, { gap: 9 }]}><Text accessibilityRole="header" style={styles.heading}>운영 안내</Text><Text style={styles.body}>{shown.openingHours || '운영시간 미등록'}</Text></View>
          {shown.verifiedAt && <Text style={styles.caption}>정보 확인일 {shown.verifiedAt.slice(0, 10).replace(/-/g, '.')}</Text>}
          <Button variant="ghost" loading={loading} onPress={() => void refresh()}>정보 다시 확인</Button>
        </View>
      </>}
    </ScrollView>
  </HospitalScreen>;
}

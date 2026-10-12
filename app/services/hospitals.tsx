import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import { DepartmentIcon } from '@/components/hospitals/DepartmentIcon';
import HospitalScreen, { hospitalStyles as styles } from '@/components/hospitals/HospitalScreen';
import { useHospitalExposure } from '@/hooks/use-hospital-exposure';
import { platformRequest, type PlatformHospital, type PlatformHospitalList, type PlatformHospitalRegions } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';
import { useReadAttempt } from '@/lib/use-read-attempt';

type Filters = { provinceCode: string; district: string; search: string; specialty: string };
const ALL: Filters = { provinceCode: '', district: '', search: '', specialty: '' };

export default function ServiceHospitals() {
  const insets = useSafeAreaInsets();
  const [regions, setRegions] = useState<PlatformHospitalRegions | null>(null);
  const [regionsError, setRegionsError] = useState(false);
  const [filters, setFilters] = useState(ALL);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<PlatformHospitalList | null>(null);
  const [dataFilters, setDataFilters] = useState<Filters>(ALL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<'province' | 'district' | null>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [allSpecialties, setAllSpecialties] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [carouselFrame, setCarouselFrame] = useState({ y: 0, height: 0 });
  const [scrollY, setScrollY] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const begin = useReadAttempt();
  const beginRegions = useReadAttempt();
  const list = useRef<FlatList<PlatformHospital>>(null);
  const carousel = useRef<ScrollView>(null);
  const filterKey = JSON.stringify(filters);
  const matching = JSON.stringify(dataFilters) === filterKey;
  const visibleData = matching ? data : null;
  const searching = !!filters.search || !!filters.specialty;
  const featured = useMemo(() => !searching ? visibleData?.featured ?? [] : [], [searching, visibleData]);
  const cardWidth = Math.min(300, Math.max(220, viewport.width - 70));
  const rows = useMemo(() => visibleData?.hospitals ?? [], [visibleData]);
  const visibleFeaturedIds = useMemo(() => {
    const top = carouselFrame.y - scrollY;
    const vertical = carouselFrame.height > 0 ? Math.max(0, Math.min(viewport.height, top + carouselFrame.height) - Math.max(0, top)) / carouselFrame.height : 0;
    return featured.filter((_, index) => {
      const left = 20 + index * (cardWidth + 12) - scrollX;
      const horizontal = Math.max(0, Math.min(viewport.width, left + cardWidth) - Math.max(0, left)) / cardWidth;
      return vertical * horizontal >= 0.5;
    }).map((hospital) => hospital.id).join('|');
  }, [carouselFrame, scrollY, viewport, featured, cardWidth, scrollX]);
  const exposed = useMemo(() => picker ? [] : [...featured.filter((hospital) => visibleFeaturedIds.split('|').includes(hospital.id)), ...rows.filter((hospital) => visibleIds.includes(hospital.id))], [picker, featured, visibleFeaturedIds, rows, visibleIds]);
  useHospitalExposure(exposed);
  const viewability = useRef({ itemVisiblePercentThreshold: 50 });
  const viewableChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<PlatformHospital>[] }) => setVisibleIds(viewableItems.filter((item) => item.isViewable).map((item) => item.item.id)));
  const province = regions?.regions.find((item) => item.provinceCode === filters.provinceCode);

  const loadRegions = useCallback(async () => {
    const owns = beginRegions();
    try {
      const next = await platformRequest<PlatformHospitalRegions>('get_hospital_regions');
      if (owns()) { setRegions(next); setRegionsError(false); }
    } catch { if (owns()) setRegionsError(true); }
  }, [beginRegions]);
  const search = useCallback(async (value: Filters, offset = 0) => {
    const owns = begin();
    setLoading(true); setError(null);
    try {
      const next = await platformRequest<PlatformHospitalList>('list_hospitals', { ...value, offset, limit: 20 });
      if (!owns()) return;
      setData((previous) => offset && previous ? { ...next, hospitals: [...new Map([...previous.hospitals, ...next.hospitals].map((hospital) => [hospital.id, hospital])).values()] } : next);
      setDataFilters(value);
      if (!offset) {
        list.current?.scrollToOffset({ offset: 0, animated: false });
        carousel.current?.scrollTo({ x: 0, animated: false });
        setScrollY(0); setScrollX(0);
      }
    } catch (cause) {
      if (owns()) setError(cause instanceof Error ? cause.message : '병원 목록을 불러오지 못했습니다.');
    } finally { if (owns()) setLoading(false); }
  }, [begin]);
  useEffect(() => { void loadRegions(); }, [loadRegions]);
  useEffect(() => { setVisibleIds([]); void search(filters); }, [filters, search]);
  const choose = (key: 'provinceCode' | 'district', value: string) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === 'provinceCode' ? { district: '' } : {}) }));
    setPicker(null);
  };
  const choices = picker === 'province'
    ? [{ value: '', label: '전국' }, ...(regions?.regions.map((item) => ({ value: item.provinceCode, label: item.provinceName })) ?? [])]
    : [{ value: '', label: '전체 시·군·구' }, ...(province?.districts.map((district) => ({ value: district, label: district })) ?? [])];
  const openDetail = (hospital: PlatformHospital) => router.push({ pathname: '/services/hospital', params: { id: hospital.id, placement: hospital.adPlacement } });
  const submitSearch = () => setFilters((current) => ({ ...current, search: query.trim() }));

  return <HospitalScreen headerActions={<Pressable accessibilityRole="button" accessibilityLabel={`시·도 선택, ${province?.provinceName ?? '전국'}`} onPress={() => setPicker('province')} style={local.region}>
    <Feather name="map-pin" size={16} color={COLORS.text.secondary} accessible={false} /><Text style={local.regionName} numberOfLines={1}>{province?.provinceName ?? '전국'}</Text><Feather name="chevron-down" size={14} color={COLORS.text.secondary} accessible={false} />
  </Pressable>}>
    <FlatList ref={list} data={rows} keyExtractor={(item) => `list:${item.id}`} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
      onLayout={({ nativeEvent }) => setViewport({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
      onScroll={({ nativeEvent }) => setScrollY(nativeEvent.contentOffset.y)} scrollEventThrottle={32}
      onViewableItemsChanged={viewableChanged.current} viewabilityConfig={viewability.current}
      ListHeaderComponent={<View style={local.homeContent}>
        <View style={local.searchGroup}>
          <FormInput accessibilityLabel="병원명 검색" value={query} onChangeText={setQuery} maxLength={80} placeholder="병원명 검색" returnKeyType="search" onSubmitEditing={submitSearch} inputWrapperStyle={local.searchInput} inputStyle={local.searchText} leftIcon={<Feather name="search" size={18} color={COLORS.text.secondary} accessible={false} />} rightIcon={<Pressable accessibilityRole="button" accessibilityLabel="병원 검색" onPress={submitSearch} style={local.searchAction}><Text style={local.searchActionText}>검색</Text></Pressable>} />
          {province && <Pressable accessibilityRole="button" accessibilityLabel={`시·군·구 선택, ${filters.district || '전체'}`} onPress={() => setPicker('district')} style={local.district}>
            <Text style={local.metadata}>{filters.district || '전체 시·군·구'}</Text><Feather name="chevron-down" size={14} color={COLORS.text.secondary} accessible={false} />
          </Pressable>}
        </View>
        {regionsError && <View style={[styles.error, local.section]}><Text accessibilityRole="alert" style={styles.body}>지역 선택 정보를 불러오지 못했습니다.</Text><Button variant="ghost" onPress={() => void loadRegions()}>지역 정보 다시 불러오기</Button></View>}
        {!!regions?.specialties.length && (searching ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={local.section} contentContainerStyle={{ gap: 8 }}>
          {['', ...regions.specialties].map((specialty) => <Pressable key={specialty} accessibilityRole="button" accessibilityState={{ selected: filters.specialty === specialty }} aria-pressed={filters.specialty === specialty} onPress={() => setFilters((current) => ({ ...current, specialty }))} style={[styles.chip, filters.specialty === specialty && styles.selectedChip]}><Text style={[styles.body, filters.specialty === specialty && styles.selectedText]}>{specialty || '전체 진료 분야'}</Text></Pressable>)}
        </ScrollView> : <View style={[local.section, { gap: 8 }]}>
          <View style={styles.row}><Text accessibilityRole="header" style={[local.sectionTitle, styles.flexible]}>진료과로 찾기</Text>{regions.specialties.length > 6 && <Pressable accessibilityRole="button" onPress={() => setAllSpecialties((current) => !current)} style={local.textButton}><Text style={local.metadata}>{allSpecialties ? '간단히 보기' : '전체 보기'}</Text><Feather name={allSpecialties ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.text.secondary} accessible={false} /></Pressable>}</View>
          <View style={local.departments}>{(allSpecialties ? regions.specialties : regions.specialties.slice(0, 6)).map((specialty) => <Pressable key={specialty} accessibilityRole="button" accessibilityLabel={`${specialty} 진료과 선택`} onPress={() => setFilters((current) => ({ ...current, specialty }))} style={({ pressed }) => [local.department, pressed && { opacity: 0.65 }]}><DepartmentIcon specialty={specialty} size={44} /><Text style={local.departmentName}>{specialty}</Text></Pressable>)}</View>
        </View>)}
        {error && <View style={[styles.error, local.section]}><Text accessibilityRole="alert" style={styles.body}>{error}</Text>{matching && data && <Text style={styles.caption}>최근 조회한 목록을 표시하고 있습니다.</Text>}<Button variant="outline" disabled={loading} onPress={() => void search(filters)}>다시 불러오기</Button></View>}
        {loading && <View style={[styles.row, local.section]}><ActivityIndicator color={COLORS.primary} /><Text accessibilityLiveRegion="polite" style={styles.body}>병원 정보를 확인하고 있어요.</Text></View>}
        {!!featured.length && <View style={[styles.row, local.featuredHeading]}>
          <Text accessibilityRole="header" style={[local.sectionTitle, styles.flexible]}>제휴병원 소개</Text>
          {featured.length > 1 && <>
            <Pressable accessibilityRole="button" accessibilityLabel="이전 병원 광고" style={styles.iconButton} onPress={() => carousel.current?.scrollTo({ x: Math.max(0, scrollX - cardWidth - 12), animated: true })}><Feather name="chevron-left" size={18} color={COLORS.text.primary} accessible={false} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="다음 병원 광고" style={styles.iconButton} onPress={() => carousel.current?.scrollTo({ x: Math.min((featured.length - 1) * (cardWidth + 12), scrollX + cardWidth + 12), animated: true })}><Feather name="chevron-right" size={18} color={COLORS.text.primary} accessible={false} /></Pressable>
          </>}
        </View>}
        {!!featured.length && <View style={local.carousel} onLayout={({ nativeEvent }) => setCarouselFrame({ y: nativeEvent.layout.y, height: nativeEvent.layout.height })}>
          <ScrollView ref={carousel} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={local.carouselContent} onScroll={({ nativeEvent }) => setScrollX(nativeEvent.contentOffset.x)} scrollEventThrottle={32}>
            {featured.map((hospital) => <Pressable key={`featured:${hospital.id}`} accessibilityRole="button" accessibilityLabel={`${hospital.name} 병원 상세 보기, 광고`} onPress={() => openDetail(hospital)} style={({ pressed }) => [local.featured, { width: cardWidth }, pressed && { opacity: 0.7 }]}>
              <View>{hospital.photoUrl ? <Image source={{ uri: hospital.photoUrl }} accessibilityLabel={`${hospital.name} 병원 사진`} style={local.featuredPhoto} /> : <View style={local.featuredFallback}><Feather name="image" size={32} color={COLORS.gray[400]} accessible={false} /><Text style={styles.caption}>병원 사진</Text></View>}<Text style={[styles.ad, local.photoAd]}>광고</Text></View>
              <View style={local.featuredCopy}><Text style={local.cardName} numberOfLines={2}>{hospital.name}</Text><Text style={local.metadata}>{hospital.region}{hospital.specialties.length ? ` · ${hospital.specialties.join(' · ')}` : ''}</Text>{!!hospital.description?.trim() && <Text style={local.description} numberOfLines={2}>{hospital.description.trim()}</Text>}<Text style={local.cardLink}>병원 알아보기 →</Text></View>
            </Pressable>)}
          </ScrollView>
        </View>}
        {!!rows.length && <View style={[styles.row, { marginBottom: 8 }]}><Text accessibilityRole="header" style={[local.sectionTitle, styles.flexible]}>{searching ? '검색 결과' : filters.provinceCode ? `${province?.provinceName ?? ''}${filters.district ? ` ${filters.district}` : ''} 제휴병원` : '전체 제휴병원'}</Text>{searching && <Pressable accessibilityRole="button" onPress={() => { setQuery(''); setFilters((current) => ({ ...current, search: '', specialty: '' })); }} style={local.textButton}><Text style={styles.selectedText}>검색 초기화</Text></Pressable>}</View>}
      </View>}
      renderItem={({ item }) => <View style={local.itemWrap}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 병원 상세 보기, 광고`} onPress={() => openDetail(item)} style={({ pressed }) => [local.listRow, pressed && { opacity: 0.7 }]}>
            {item.photoUrl ? <Image source={{ uri: item.photoUrl }} accessibilityLabel={`${item.name} 병원 사진`} style={local.thumbnail} /> : <View style={local.thumbnail}><Feather name="image" size={26} color={COLORS.gray[400]} accessible={false} /></View>}
            <View style={[styles.flexible, { gap: 6 }]}>
              <View style={styles.row}><Text style={[local.listName, styles.flexible]}>{item.name}</Text><Text style={styles.ad}>광고</Text></View>
              {!!item.specialties.length && <Text style={local.metadata}>{item.specialties.join(' · ')}</Text>}
              <Text style={local.metadata}>{item.address || item.region}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={COLORS.text.secondary} accessible={false} />
          </Pressable>
        </View>}
      ListEmptyComponent={!loading && !error && visibleData ? <View style={[styles.content, styles.empty]}><Feather name="search" size={36} color={COLORS.text.secondary} accessible={false} /><Text style={styles.heading}>조건에 맞는 제휴병원이 없어요</Text><Text style={[styles.body, { textAlign: 'center' }]}>다른 지역이나 진료 분야를 선택해 보세요.</Text>{filterKey !== JSON.stringify(ALL) && <Button variant="outline" onPress={() => { setQuery(''); setFilters(ALL); }}>전체 제휴병원 보기</Button>}</View> : null}
      ListFooterComponent={visibleData && rows.length ? <View style={styles.content}>
        <Text style={styles.caption}>제휴병원 {rows.length}곳 확인{visibleData.hasMore ? ' · 다음 목록이 있어요' : ''}</Text>
        {visibleData.hasMore && <Button variant="outline" loading={loading} onPress={() => { if (!loading && visibleData.nextOffset !== null) void search(filters, visibleData.nextOffset); }}>병원 더 보기</Button>}
      </View> : null}
    />
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={local.modalBackdrop}><View accessibilityViewIsModal style={local.modalPanel}>
        <View style={styles.row}><Text accessibilityRole="header" style={[styles.heading, styles.flexible]}>{picker === 'province' ? '시·도 선택' : '시·군·구 선택'}</Text><Pressable accessibilityRole="button" accessibilityLabel="지역 선택 닫기" style={styles.iconButton} onPress={() => setPicker(null)}><Feather name="x" size={22} color={COLORS.text.primary} accessible={false} /></Pressable></View>
        <ScrollView>{choices.map((choice) => <Pressable key={choice.value} accessibilityRole="button" accessibilityState={{ selected: choice.value === (picker === 'province' ? filters.provinceCode : filters.district) }} aria-pressed={choice.value === (picker === 'province' ? filters.provinceCode : filters.district)} style={local.choice} onPress={() => choose(picker === 'province' ? 'provinceCode' : 'district', choice.value)}><Text style={styles.body}>{choice.label}</Text>{choice.value === (picker === 'province' ? filters.provinceCode : filters.district) && <Feather name="check" size={18} color={COLORS.primaryDark} accessible={false} />}</Pressable>)}</ScrollView>
      </View></View>
    </Modal>
  </HospitalScreen>;
}

const local = StyleSheet.create({
  homeContent: { paddingHorizontal: 20, paddingTop: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700', color: COLORS.text.primary },
  region: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8 },
  regionName: { minWidth: 0, flexShrink: 1, fontSize: 14, lineHeight: 21, fontWeight: '600', color: COLORS.text.primary },
  district: { minHeight: 44, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchGroup: { marginBottom: 20, gap: 4 },
  searchInput: { height: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  searchText: { fontSize: 14, minWidth: 0, flexShrink: 1 },
  searchAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  searchActionText: { fontSize: 13, fontWeight: '600', color: COLORS.primaryDark },
  itemWrap: { paddingHorizontal: 20 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100] },
  listName: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: COLORS.text.primary },
  thumbnail: { width: 88, height: 88, borderRadius: 12, backgroundColor: COLORS.gray[50], alignItems: 'center', justifyContent: 'center' },
  metadata: { fontSize: 13, lineHeight: 20, color: COLORS.text.secondary },
  departments: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  department: { width: '33.333%', minHeight: 68, alignItems: 'center', gap: 4, paddingHorizontal: 3 },
  departmentName: { fontSize: 12, lineHeight: 20, fontWeight: '600', color: COLORS.text.primary, textAlign: 'center' },
  textButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  featuredHeading: { marginBottom: 8 },
  carousel: { marginHorizontal: -20, marginBottom: 24 },
  carouselContent: { paddingHorizontal: 20, gap: 12, alignItems: 'stretch' },
  featured: { borderRadius: 16, overflow: 'hidden', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray[100] },
  featuredPhoto: { width: '100%', height: 172 },
  featuredFallback: { height: 172, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.gray[50] },
  photoAd: { position: 'absolute', top: 10, left: 10, borderColor: 'rgba(255,255,255,0.8)', backgroundColor: 'rgba(255,255,255,0.9)', paddingVertical: 1 },
  featuredCopy: { padding: 14, gap: 6 },
  cardName: { fontSize: 18, lineHeight: 26, fontWeight: '700', color: COLORS.text.primary },
  description: { fontSize: 13, lineHeight: 20, color: COLORS.text.secondary },
  cardLink: { fontSize: 13, lineHeight: 20, fontWeight: '600', color: COLORS.primaryDark, marginTop: 2 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: COLORS.background.overlay },
  modalPanel: { maxHeight: '75%', maxWidth: 480, width: '100%', alignSelf: 'center', padding: 20, backgroundColor: COLORS.white, borderRadius: 18 },
  choice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: COLORS.border.light, paddingVertical: 12 },
});

import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormInput } from '@/components/FormInput';
import CareRequestAdmin, { type AdminCareRequest, type CareMetrics } from '@/components/hospitals/CareRequestAdmin';
import HospitalContractFields, { EMPTY_HOSPITAL_DRAFT, type HospitalDraft } from '@/components/hospitals/HospitalContractFields';
import HospitalPerformanceReport from '@/components/hospitals/HospitalPerformanceReport';
import { OptionSheetField } from '@/components/OptionSheetField';
import { ActionRows, ChoiceRows, SegmentedControl } from '@/components/SelectionControls';
import ServiceInformation, { ServiceAction, informationStyles as styles } from '@/components/ServiceInformation';
import { useDraftExitGuard } from '@/hooks/use-draft-exit-guard';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { createCreationRequestTracker } from '@/lib/board-comment-request';
import { getSeoulTodayIsoDate } from '@/lib/admin-assisted-signup-validation';
import { parseCalendarDate } from '@/lib/calendar-date';
import { HOSPITAL_PROVINCES, PLATFORM_SERVICES, PlatformApiError, platformRequest, type PlatformService } from '@/lib/platform-api';
import { useReadAttempt } from '@/lib/use-read-attempt';

type Partner = { id: string; service_key: PlatformService; name: string; region: string; address: string; website_url: string; phone: string; consumer_rate: number; referrer_rate: number; referrer_basis: 'commission' | 'after_consumer'; active: boolean; revision: number; ad_period_start: string | null; ad_period_end: string | null; ad_placement: string | null; ad_fee: number | null; province_code: string | null; district: string | null; specialties: string[]; description: string | null; photo_url: string | null; opening_hours: string | null; verified_at: string | null; material_approved: boolean; review_required: boolean | null; review_number: string | null; review_expires_at: string | null };
type Application = { id: string; service_key: Exclude<PlatformService, 'hospital'>; status: string; created_at: string };
type Settlement = { id: string; application_id: string; commission_amount: number; due_at: string };
type Benefit = { id: string; service_key: PlatformService; amount: number; status: 'pending' | 'paid' };
type AdminData = { partners: Partner[]; applications: Application[]; settlements: Settlement[]; benefits: Benefit[]; careRequests?: AdminCareRequest[]; careMetrics?: CareMetrics };
const EMPTY_PARTNER = { name: '', region: '', address: '', websiteUrl: '', phone: '', consumerRate: '', referrerRate: '', adPeriodStart: '', adPeriodEnd: '', adPlacement: '', adFee: '' };
const EMPTY_SETTLEMENT = { commissionAmount: '', settledAt: '', transactionReference: '', settlementEvidenceReference: '' };

export default function ServiceManage() {
  const session = useSession();
  const keyboardPadding = useKeyboardPadding();
  const token = session.appSessionToken;
  const allowed = session.role === 'admin' && !session.readOnly && session.staffType === 'admin';
  const ownerKey = JSON.stringify([token, allowed]);
  const owner = useRef(ownerKey); owner.current = ownerKey;
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const beginRead = useReadAttempt();
  const beginWrite = useReadAttempt();
  const tracker = useRef(createCreationRequestTracker(randomUUID));
  const [serviceKey, setServiceKey] = useState<PlatformService>('care');
  const [partnerId, setPartnerId] = useState(() => randomUUID());
  const [fields, setFields] = useState(EMPTY_PARTNER);
  const [hospital, setHospital] = useState<HospitalDraft>(EMPTY_HOSPITAL_DRAFT);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(false);
  const [referrerBasis, setReferrerBasis] = useState<'commission' | 'after_consumer'>('after_consumer');
  const [applicationId, setApplicationId] = useState('');
  const [settlementPartnerId, setSettlementPartnerId] = useState('');
  const [settlement, setSettlement] = useState(EMPTY_SETTLEMENT);
  const [confirmed, setConfirmed] = useState(false);
  const [benefitId, setBenefitId] = useState('');
  const [payment, setPayment] = useState({ paidAt: '', transferReference: '' });
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const hospitalDraftChanged = hospital.reviewRequired !== null || Object.values(hospital).some((value) => typeof value === 'string' ? value.trim() : value);
  useDraftExitGuard(Object.values(fields).some((value) => value.trim()) || hospitalDraftChanged || Object.values(settlement).some((value) => value.trim()) || Object.values(payment).some((value) => value.trim()), busy);
  const refresh = async () => {
    if (!allowed || !token) return;
    const owns = beginRead();
    try {
      const next = await platformRequest<AdminData>('get_admin', {}, token);
      if (owns() && owner.current === ownerKey) { setData(next); setError(null); }
    } catch (cause) {
      if (!owns() || owner.current !== ownerKey) return;
      if (cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403)) setData(null);
      setError(cause instanceof Error ? cause.message : '내역을 확인하지 못했습니다.');
    }
  };
  const refreshManually = async () => {
    if (pending.current || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { await refresh(); } finally { refreshingRef.current = false; setRefreshing(false); }
  };
  // The signed server checks admin authority again on every read and mutation.
  useEffect(() => {
    beginRead(); beginWrite(); pending.current = false; setBusy(false); setBusyAction(null); setError(null); setMessage(null);
    setData(null); setFields(EMPTY_PARTNER); setHospital(EMPTY_HOSPITAL_DRAFT); setSettlement(EMPTY_SETTLEMENT);
    setEditing(false); setRevision(0); setPartnerId(randomUUID()); setActive(false);
    setApplicationId(''); setSettlementPartnerId(''); setConfirmed(false); tracker.current.complete();
    setBenefitId(''); setPayment({ paidAt: '', transferReference: '' }); setPaymentConfirmed(false);
    void refresh();
  // Reset drafts only when the account changes; refresh reads the current owner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, allowed]);
  const write = async (action: string, payload: Record<string, unknown>) => {
    if (pending.current || !allowed || !token) return;
    pending.current = true; setBusy(true); setBusyAction(action); setError(null); setMessage(null);
    const owns = beginWrite(); beginRead();
    const requestKey = tracker.current.requestId(JSON.stringify([token, action, payload]));
    try {
      await platformRequest(action, { ...payload, ...(action === 'settle_application' ? { idempotencyKey: requestKey } : {}) }, token);
      if (!owns() || owner.current !== ownerKey) return;
      tracker.current.complete(requestKey); setMessage('저장했습니다.');
      if (action === 'save_partner') { setFields(EMPTY_PARTNER); setHospital(EMPTY_HOSPITAL_DRAFT); setPartnerId(randomUUID()); setEditing(false); setRevision(0); setActive(false); }
      else if (action === 'settle_application') { setSettlement(EMPTY_SETTLEMENT); setConfirmed(false); }
      else if (action === 'mark_paid') { setPayment({ paidAt: '', transferReference: '' }); setPaymentConfirmed(false); setBenefitId(''); }
    } catch (cause) {
      if (owns() && owner.current === ownerKey) {
        if (cause instanceof PlatformApiError && (cause.status === 401 || cause.status === 403)) setData(null);
        setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 입력을 유지했습니다.');
      }
      return;
    }
    finally { if (owns() && owner.current === ownerKey) { pending.current = false; setBusy(false); setBusyAction(null); } }
    await refresh();
  };
  const savePartner = () => {
    const informational = serviceKey === 'hospital' || serviceKey === 'insurance';
    const consumerRate = informational ? 0 : Number(fields.consumerRate) / 100;
    const referrerRate = informational ? 0 : Number(fields.referrerRate) / 100;
    if (!informational && (!fields.consumerRate.trim() || !fields.referrerRate.trim())) { setError('합의한 지급 비율을 입력해 주세요.'); return; }
    if (serviceKey === 'hospital' && active) {
      if (!hospital.provinceCode || !hospital.district.trim() || !fields.address.trim() || !parseCalendarDate(hospital.verifiedAt) || hospital.verifiedAt > getSeoulTodayIsoDate()) { setError('공개할 병원의 시·도, 시·군·구, 주소와 정보 확인일을 입력해 주세요. 확인일은 오늘 또는 이전 날짜여야 합니다.'); return; }
      if (!hospital.materialApproved || hospital.reviewRequired === null) { setError('병원 소재 승인과 의료광고 심의 대상 여부를 먼저 확인해 주세요.'); return; }
      if (hospital.reviewRequired && (!hospital.reviewNumber.trim() || !parseCalendarDate(hospital.reviewExpiresAt) || hospital.reviewExpiresAt < getSeoulTodayIsoDate())) { setError('유효한 의료광고 심의 승인 번호와 종료일을 입력해 주세요.'); return; }
    }
    const hospitalPayload = serviceKey === 'hospital' ? {
      ...hospital, specialties: hospital.specialties.split(',').map((value) => value.trim()).filter(Boolean),
      verifiedAt: hospital.verifiedAt || null, reviewNumber: hospital.reviewRequired ? hospital.reviewNumber.trim() || null : null, reviewExpiresAt: hospital.reviewRequired ? hospital.reviewExpiresAt || null : null,
      region: `${HOSPITAL_PROVINCES.find((province) => province.code === hospital.provinceCode)?.name ?? ''} ${hospital.district}`.trim(),
    } : {};
    void write('save_partner', { ...fields, ...hospitalPayload, id: partnerId, expectedRevision: revision, serviceKey, active, consumerRate, referrerRate, referrerBasis: informational ? 'commission' : referrerBasis, adFee: fields.adFee ? Number(fields.adFee) : null });
  };
  return <ServiceInformation title="제휴·정산 관리">
    <View style={{ paddingBottom: keyboardPadding }}>
    {!session.hydrated ? <Text style={styles.body}>권한을 확인하고 있습니다.</Text> : !allowed ? <Text style={styles.body}>관리자 계정으로 로그인해 주세요.</Text> : <>
      <Text accessibilityRole="header" style={styles.title}>제휴와 정산</Text>
      <Text style={styles.body}>실제 합의한 제휴와 비율만 등록하세요. 이 화면은 정산 기록을 관리하며, 은행 이체를 실행하지 않습니다.</Text>
      {error && <Text accessibilityRole="alert" style={styles.body}>{error}</Text>}
      {message && <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text>}
      <ServiceAction label={refreshing ? '확인 중...' : '내역 새로 확인'} onPress={() => { void refreshManually(); }} />
      <CareRequestAdmin requests={data?.careRequests ?? []} metrics={data?.careMetrics ?? null} busy={busy}
        onRespond={(requestId, status, note) => void write('respond_hospital_care', { requestId, status, note: note || null })}
        onMark={(requestId, milestone) => void write('mark_hospital_care', { requestId, milestone })} />
      <Text style={styles.sectionTitle}>제휴사 등록</Text>
      {!!data?.partners.length && <View style={{ marginBottom: 16 }}><ActionRows items={data.partners.map((partner) => ({ key: partner.id, label: partner.name,
        detail: `${PLATFORM_SERVICES[partner.service_key]} · ${partner.active ? '활성' : '중지'}`, disabled: busy, onPress: () => {
        setEditing(true); setPartnerId(partner.id); setRevision(partner.revision); setServiceKey(partner.service_key);
        setActive(partner.active); setReferrerBasis(partner.referrer_basis);
        setHospital({ provinceCode: partner.province_code ?? '', district: partner.district ?? '', specialties: (partner.specialties ?? []).join(', '), description: partner.description ?? '', photoUrl: partner.photo_url ?? '', openingHours: partner.opening_hours ?? '', verifiedAt: partner.verified_at ?? '', materialApproved: partner.material_approved ?? false, reviewRequired: partner.review_required ?? null, reviewNumber: partner.review_number ?? '', reviewExpiresAt: partner.review_expires_at ?? '' });
        setFields({ name: partner.name, region: partner.region, address: partner.address, websiteUrl: partner.website_url, phone: partner.phone,
          consumerRate: String(Number(partner.consumer_rate) * 100), referrerRate: String(Number(partner.referrer_rate) * 100),
          adPeriodStart: partner.ad_period_start ?? '', adPeriodEnd: partner.ad_period_end ?? '', adPlacement: partner.ad_placement ?? '', adFee: partner.ad_fee === null ? '' : String(partner.ad_fee) });
      } }))} /></View>}
      {editing && <Button variant="ghost" disabled={busy} onPress={() => { setEditing(false); setRevision(0); setPartnerId(randomUUID()); setFields(EMPTY_PARTNER); setHospital(EMPTY_HOSPITAL_DRAFT); setActive(false); }}>새 제휴사 등록으로 전환</Button>}
      <View style={{ marginBottom: 16 }}>
        <OptionSheetField label="제휴 서비스" value={serviceKey} disabled={busy || editing} onChange={setServiceKey}
          options={(Object.entries(PLATFORM_SERVICES) as [PlatformService, string][]).map(([value, label]) => ({ value, label }))} />
      </View>
      {(['name', 'region', 'address', 'websiteUrl', 'phone'] as const).filter((key) => serviceKey !== 'hospital' || key !== 'region').map((key) => <FormInput key={key} label={{ name: serviceKey === 'hospital' ? '병원명' : '제휴사명', region: '지역', address: '주소', websiteUrl: '홈페이지 주소', phone: '대표 연락처' }[key]} accessibilityLabel={key} value={fields[key]} editable={!busy} maxLength={key === 'websiteUrl' ? 500 : key === 'region' ? 50 : 100} onChangeText={(value) => setFields((current) => ({ ...current, [key]: value }))} />)}
      {serviceKey === 'hospital' ? <>
        <HospitalContractFields draft={hospital} busy={busy} onChange={setHospital} />
        <Text style={styles.sectionTitle}>광고 계약</Text>
        {(['adPeriodStart', 'adPeriodEnd', 'adFee'] as const).map((key) => <FormInput key={key} label={{ adPeriodStart: '광고 시작일 (YYYY-MM-DD)', adPeriodEnd: '광고 종료일 (YYYY-MM-DD)', adFee: '광고비 (원)' }[key]} accessibilityLabel={key} value={fields[key]} editable={!busy} keyboardType={key === 'adFee' ? 'number-pad' : 'default'} maxLength={key === 'adFee' ? 15 : 10} onChangeText={(value) => setFields((current) => ({ ...current, [key]: value }))} />)}
        <Text style={styles.item}>계약 노출 위치</Text>
        <View style={{ marginBottom: 16 }}>
          <SegmentedControl label="계약 노출 위치" value={fields.adPlacement as 'regional_list' | 'regional_featured' | ''} disabled={busy}
            options={[{ value: 'regional_list', label: '지역 목록' }, { value: 'regional_featured', label: '지역 강조' }]}
            onChange={(adPlacement) => setFields((current) => ({ ...current, adPlacement }))} />
        </View>
        <Text style={styles.body}>선택한 지역·기간에 승인한 소재를 노출합니다. 강조 지면은 해당 조건의 계약이 여러 개면 순환 표시합니다.</Text>
      </> : serviceKey === 'insurance' ? <Text style={styles.body}>보험 상담 서비스는 준비 중입니다. 보험 증원수당은 기존 보험 업무에서 확인합니다.</Text> : <>
        <Text style={styles.body}>소비자 혜택은 수수료 총액에 적용합니다. 직접 추천인 비율의 기준을 합의한 내용대로 선택하세요. 원 미만은 버립니다.</Text>
        <FormInput label="소비자 지급 비율 (%)" accessibilityLabel="소비자 지급 비율" value={fields.consumerRate} editable={!busy} keyboardType="decimal-pad" maxLength={8} onChangeText={(value) => setFields((current) => ({ ...current, consumerRate: value }))} />
        <FormInput label="직접 추천인 지급 비율 (%)" accessibilityLabel="직접 추천인 지급 비율" value={fields.referrerRate} editable={!busy} keyboardType="decimal-pad" maxLength={8} onChangeText={(value) => setFields((current) => ({ ...current, referrerRate: value }))} />
        <View style={{ marginBottom: 22 }}>
          <ChoiceRows label="직접 추천인 비율 기준" value={referrerBasis} disabled={busy} onChange={setReferrerBasis}
            options={[{ value: 'after_consumer', label: '소비자 혜택을 뺀 나머지 기준' }, { value: 'commission', label: '수수료 총액 기준' }]} />
        </View>
      </>}
      <Pressable accessibilityRole="checkbox" accessibilityLabel="제휴사 활성화" accessibilityState={{ checked: active, disabled: busy }} disabled={busy} style={styles.list} onPress={() => setActive((value) => !value)}><Text style={styles.item}>{active ? '☑' : '□'} 제휴를 확인하여 활성화합니다.</Text></Pressable>
      <Button loading={busyAction === 'save_partner'} disabled={busy} fullWidth onPress={savePartner}>{editing ? '제휴사 수정 저장' : '합의된 제휴사 등록'}</Button>
      <HospitalPerformanceReport token={token} allowed={allowed} partners={(data?.partners ?? []).filter((partner) => partner.service_key === 'hospital')} />
      <Text style={styles.sectionTitle}>외부 거래·정산 확인</Text>
      <View style={{ gap: 16, marginBottom: 16 }}>
        <OptionSheetField label="정산할 신청" value={applicationId} disabled={busy} onChange={(id) => { setApplicationId(id); setSettlementPartnerId(''); setConfirmed(false); }}
          options={(data?.applications ?? []).filter((item) => item.status === 'interest' && item.service_key !== 'insurance')
            .map((item) => ({ value: item.id, label: `${PLATFORM_SERVICES[item.service_key]} · ${new Date(item.created_at).toLocaleDateString('ko-KR')} · ${item.id.slice(0, 8)}` }))} />
        {!!applicationId && <OptionSheetField label="정산 제휴사" value={settlementPartnerId} disabled={busy} onChange={setSettlementPartnerId}
          options={(data?.partners ?? []).filter((partner) => partner.active && partner.service_key === data?.applications.find((item) => item.id === applicationId)?.service_key)
            .map((partner) => ({ value: partner.id, label: partner.name }))} />}
      </View>
      {(['commissionAmount', 'settledAt', 'transactionReference', 'settlementEvidenceReference'] as const).map((key) => <FormInput key={key} label={{ commissionAmount: '제휴사 정산 수수료 총액 (원)', settledAt: '정산 완료 시각 (시간대 포함)', transactionReference: '실제 거래 식별 번호', settlementEvidenceReference: '제휴사 정산 증빙 식별 번호' }[key]} accessibilityLabel={key} value={settlement[key]} editable={!busy} maxLength={key === 'settlementEvidenceReference' ? 200 : 120} placeholder={key === 'settledAt' ? '2026-10-11T13:00:00+09:00' : undefined} onChangeText={(value) => setSettlement((current) => ({ ...current, [key]: value }))} />)}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: busy }} disabled={busy} style={styles.list} onPress={() => setConfirmed((value) => !value)}>
        <Text style={styles.item}>{confirmed ? '☑' : '□'} 실제 거래·취소 여부와 제휴사 정산 완료 증빙을 확인했습니다.</Text>
      </Pressable>
      <Button loading={busyAction === 'settle_application'} disabled={busy || !confirmed || !applicationId || !settlementPartnerId} fullWidth onPress={() => {
        const amount = Number(settlement.commissionAmount);
        if (!settlement.commissionAmount.trim() || !Number.isSafeInteger(amount) || amount < 0) { setError('수수료 총액을 원 단위로 입력해 주세요.'); return; }
        void write('settle_application', { ...settlement, commissionAmount: amount, applicationId, partnerId: settlementPartnerId, confirmedCompleted: true });
      }}>정산 확정·7일 지급 기한 기록</Button>
      <Text style={styles.sectionTitle}>확정한 정산</Text>
      <Text style={styles.body}>각 목록은 최신100건을 표시합니다. 누적 총액은 계산하지 않습니다.</Text>
      {data?.settlements.length === 0 && <Text style={styles.body}>확정한 정산이 없습니다.</Text>}
      {data?.settlements.map((item) => <View key={item.id} style={styles.list}><Text style={styles.item}>{Number(item.commission_amount).toLocaleString('ko-KR')}원 · 지급 기한 {new Date(item.due_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text></View>)}
      <Text style={styles.sectionTitle}>실제 지급 기록</Text>
      <Text style={styles.body}>은행 이체를 마친 뒤 대상·시각·이체 식별 번호를 기록하세요. 기록만으로 이체가 실행되지는 않습니다.</Text>
      <View style={{ marginBottom: 16 }}>
        <OptionSheetField label="지급 대상" value={benefitId} disabled={busy} onChange={(id) => { setBenefitId(id); setPaymentConfirmed(false); }}
          options={(data?.benefits ?? []).filter((item) => item.status === 'pending')
            .map((item) => ({ value: item.id, label: `${PLATFORM_SERVICES[item.service_key]} · ${Number(item.amount).toLocaleString('ko-KR')}원 · ${item.id.slice(0, 8)}` }))} />
      </View>
      <FormInput label="실제 지급 시각 (시간대 포함)" accessibilityLabel="실제 지급 시각" value={payment.paidAt} editable={!busy} placeholder="2026-10-11T13:00:00+09:00" maxLength={40} onChangeText={(value) => setPayment((current) => ({ ...current, paidAt: value }))} />
      <FormInput label="이체 식별 번호" accessibilityLabel="이체 식별 번호" value={payment.transferReference} editable={!busy} maxLength={120} onChangeText={(value) => setPayment((current) => ({ ...current, transferReference: value }))} />
      <Pressable accessibilityRole="checkbox" accessibilityLabel="실제 이체 확인" accessibilityState={{ checked: paymentConfirmed, disabled: busy }} disabled={busy} style={styles.list} onPress={() => setPaymentConfirmed((value) => !value)}><Text style={styles.item}>{paymentConfirmed ? '☑' : '□'} 해당 대상에게 실제 이체가 완료된 것을 확인했습니다.</Text></Pressable>
      <Button loading={busyAction === 'mark_paid'} disabled={busy || !benefitId || !paymentConfirmed || !payment.paidAt || !payment.transferReference} fullWidth onPress={() => void write('mark_paid', { ...payment, benefitId })}>실제 지급 완료 기록</Button>
    </>}
    </View>
  </ServiceInformation>;
}

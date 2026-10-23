/* eslint-disable @typescript-eslint/no-require-imports */
import { CARE_HOSPITAL_ID, HOSPITAL_DEMO_ENABLED, PlatformApiError, platformRequest, type PlatformHospital, type PlatformHospitalList, type PlatformHospitalRegions } from '../platform-api';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('react-native', () => ({ Image: { resolveAssetSource: (source: number) => ({ uri: `asset:/hospital-${source}.png` }) } }));
jest.mock('@/assets/images/hospital-demo/general-clinic.png', () => 1);
jest.mock('@/assets/images/hospital-demo/dental-clinic.png', () => ({ uri: 'asset:/hospital-2.png' }));
jest.mock('@/assets/images/hospital-demo/clinic-exterior.png', () => 'asset:/hospital-3.png');
jest.mock('@/assets/images/hospital-demo/goodmorning-cheongju-exterior.jpg', () => 'asset:/partner-exterior.jpg');
const invoke = supabase.functions.invoke as jest.Mock;
const hospital = {
  id: '10000000-0000-4000-8000-000000000001', name: '합성 시험 병원', region: '서울 마포구', provinceCode: '11', provinceName: '서울', district: '마포구',
  address: '시험 주소', phone: null, websiteUrl: null, specialties: ['내과'], description: null, photoUrl: null, openingHours: null, verifiedAt: '2026-10-11',
  adPlacement: 'regional_list', revision: 0, measurementToken: 'synthetic-receipt',
};

describe('common platform transport', () => {
  beforeEach(() => invoke.mockReset());
  it('sends the explicitly selected token only to the purpose isolated endpoint', async () => {
    invoke.mockResolvedValue({ data: { ok: true, applicationId: 'synthetic' }, error: null });
    await platformRequest('apply', { serviceKey: 'care' }, 'synthetic-member-token');
    expect(invoke).toHaveBeenCalledWith('platform-service', { body: { action: 'apply', serviceKey: 'care' }, headers: { 'x-app-session-token': 'synthetic-member-token' } });
  });
  it('requires a matching complete withdrawal receipt and keeps pending closure distinct from deletion', async () => {
    const payload = { confirmed: true, scope: 'all_affiliates', policyVersion: '2026-10-14', idempotencyKey: hospital.id };
    const completed = { ok: true, operationId: hospital.id, status: 'completed', deleted: true, cleanupPending: false };
    invoke.mockResolvedValue({ data: completed, error: null });
    expect(await platformRequest('withdraw_member', payload, 'synthetic-owner')).toEqual(completed);
    expect(invoke.mock.calls[0][1]).toMatchObject({ body: { action: 'withdraw_member', ...payload }, timeout: 12000, headers: { 'x-app-session-token': 'synthetic-owner' } });
    const pending = { ...completed, status: 'pending', deleted: false, cleanupPending: true, reason: 'affiliate_identity_unbound' };
    invoke.mockResolvedValue({ data: pending, error: null });
    expect(await platformRequest('withdraw_member', payload, 'synthetic-owner')).toEqual(pending);
    invoke.mockResolvedValue({ data: { ok: true, withdrawal: pending }, error: null });
    await expect(platformRequest('get_withdrawal', {}, 'synthetic-owner')).resolves.toEqual({ ok: true, withdrawal: pending });
    invoke.mockResolvedValue({ data: { ok: true, withdrawal: null }, error: null });
    await expect(platformRequest('get_withdrawal', {}, 'synthetic-owner')).resolves.toEqual({ ok: true, withdrawal: null });
    invoke.mockResolvedValue({ data: { ok: true, withdrawal: { ...pending, deleted: true } }, error: null });
    await expect(platformRequest('get_withdrawal', {}, 'synthetic-owner')).rejects.toMatchObject({ code: 'invalid_response' });
    const canonicalId = 'abcdef00-0000-4000-8000-000000000001';
    invoke.mockResolvedValue({ data: { ...completed, operationId: canonicalId }, error: null });
    await expect(platformRequest('withdraw_member', { ...payload, idempotencyKey: canonicalId.toUpperCase() }, 'synthetic-owner')).resolves.toMatchObject({ operationId: canonicalId });
    for (const invalid of [{ ok: true }, { ...completed, deleted: false }, { ...completed, cleanupPending: true },
      { ...pending, deleted: true }, { ...pending, reason: 'unvalidated_reason' },
      { ...completed, operationId: '10000000-0000-4000-8000-000000000099' }]) {
      invoke.mockResolvedValue({ data: invalid, error: null });
      await expect(platformRequest('withdraw_member', payload, 'synthetic-owner')).rejects.toMatchObject({ code: 'invalid_response' });
    }
    invoke.mockResolvedValue({ data: { ok: false, code: 'upgrade_required' }, error: null });
    await expect(platformRequest('delete_member', { confirmed: true }, 'synthetic-owner')).rejects.toMatchObject({ code: 'upgrade_required', message: expect.stringContaining('최신 앱') });
  });
  it('does not attach a protected token to public directory requests', async () => {
    const response = { ok: true, hospitals: [hospital], featured: [], hasMore: false, nextOffset: null };
    invoke.mockResolvedValue({ data: response, error: null });
    expect(await platformRequest('list_hospitals')).toEqual(response);
    expect(invoke.mock.calls[0][1].headers).toBeUndefined();
    expect(invoke.mock.calls[0][1].timeout).toBeUndefined();
    expect(HOSPITAL_DEMO_ENABLED).toBe(false);
  });
  it.each([
    ['get_hospital_regions', { ok: true, regions: [], specialties: [] }],
    ['get_hospital', { ok: true, hospital }],
    ['record_hospital_event', { ok: true }],
  ])('keeps %s on the existing transport when demo mode is disabled', async (action, response) => {
    invoke.mockResolvedValue({ data: response, error: null });
    expect(await platformRequest(action, { hospitalId: hospital.id })).toEqual(response);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['list_hospitals', { ok: true, hospitals: null, featured: [], hasMore: false, nextOffset: null }],
    ['get_hospital', { ok: true, hospital: { ...hospital, measurementToken: null } }],
    ['get_hospital_regions', { ok: true, regions: [{ provinceCode: '11', provinceName: '서울', districts: null }], specialties: [] }],
    ['get_hospital_report', { ok: true, from: '2026-10-01', to: '2026-10-11', measurement: 'anonymous_client_events', rows: [], totals: { impressions: -1, detailViews: 0, phoneClicks: 0, directionsClicks: 0 } }],
  ])('rejects invalid %s instead of displaying empty or misleading hospital data', async (action, response) => {
    invoke.mockResolvedValue({ data: response, error: null });
    await expect(platformRequest(action)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('validates reports and sends the chosen administrator session', async () => {
    const totals = { impressions: 3, detailViews: 2, phoneClicks: 1, directionsClicks: 0 };
    const response = { ok: true, from: '2026-10-01', to: '2026-10-11', measurement: 'anonymous_client_events', rows: [{ ...totals, partnerId: hospital.id, name: hospital.name, revision: 0, placement: 'regional_list', date: '2026-10-11' }], totals };
    invoke.mockResolvedValue({ data: response, error: null });
    expect(await platformRequest('get_hospital_report', { from: response.from, to: response.to }, 'synthetic-admin')).toEqual(response);
    expect(invoke.mock.calls[0][1].headers).toEqual({ 'x-app-session-token': 'synthetic-admin' });
  });
  it('preserves HTTP status and offers Korean recovery for expired authentication', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, code: 'invalid_app_session' }), { status: 401 }) } });
    await expect(platformRequest('get_account', {}, 'expired')).rejects.toMatchObject({ status: 401, code: 'invalid_app_session', message: expect.stringContaining('다시 로그인') });
  });
  it.each([
    ['not_found', 401, '가입되지 않은 번호'],
    ['inactive_admin', 401, '사용이 중지'],
    ['inactive_manager', 401, '사용이 중지'],
    ['missing_password', 401, '비밀번호를 입력'],
    ['login_unavailable', 503, '로그인을 처리하지'],
  ])('maps relayed %s login rejection instead of reporting an expired session', async (code, status, message) => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, code }), { status }) } });
    const failure = platformRequest('login', { phone: '01000000000', password: 'Synthetic1!' });
    await expect(failure).rejects.toMatchObject({ status, code, message: expect.stringContaining(message) });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('만료') });
  });
  it.each([
    ['already_exists', 409, '이미 가입'],
    ['cooldown', 429, '60초'],
    ['locked', 429, '10분'],
  ])('preserves %s status and gives the matching OTP recovery', async (code, status, message) => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, code }), { status }) } });
    await expect(platformRequest('request_otp')).rejects.toMatchObject({ code, status, message: expect.stringContaining(message) });
  });
  it('maps aborted transport failures to a bounded timeout recovery without exposing raw details', async () => {
    invoke.mockResolvedValue({ data: null, error: {
      name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function',
      context: new DOMException('The operation was aborted by transport internals','AbortError'),
    } });
    await expect(platformRequest('request_otp')).rejects.toMatchObject({ code: 'request_timeout', message: expect.stringContaining('응답이 늦어') });
    expect(invoke.mock.calls[0][1].timeout).toBe(12000);
  });
  it('does not pass raw transport errors or malformed account lists to screens', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    await expect(platformRequest('get_account')).rejects.toThrow('연결하지 못했습니다');
    invoke.mockResolvedValueOnce({ data: { ok: true, applications: null }, error: null });
    await expect(platformRequest('get_account')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('keeps an unknown failure as a failure instead of returning empty data', async () => {
    invoke.mockResolvedValue({ data: { ok: false, code: 'future_error' }, error: null });
    await expect(platformRequest('apply')).rejects.toBeInstanceOf(PlatformApiError);
  });
  it('preserves only recovery metadata from a rejected common login', async () => {
    const response = { ok: false, code: 'password_change_required', role: 'fc', passwordChangeToken: 'synthetic-change-token',
      passwordChangeExpiresAt: '2026-10-14T00:00:00Z', message: 'synthetic internal detail', password: 'must-not-pass' };
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify(response), { status: 409 }) } });
    await expect(platformRequest('login')).rejects.toMatchObject({ code: response.code, status: 409,
      loginRejection: { role: 'fc', passwordChangeToken: response.passwordChangeToken, passwordChangeExpiresAt: response.passwordChangeExpiresAt } });
    try { await platformRequest('login'); } catch (failure) {
      expect((failure as PlatformApiError).loginRejection).not.toHaveProperty('password');
      expect((failure as PlatformApiError).message).not.toContain('internal detail');
    }
  });
  it('validates signed service enrollment receipts and authenticated referral responses', async () => {
    const insuranceSession = { ok: true, role: 'fc', residentId: '01000000000', appSessionToken: 'synthetic-fc-token' };
    invoke.mockResolvedValue({ data: { ok: true, insuranceSession, alreadyApplied: false }, error: null });
    await expect(platformRequest('enroll_insurance', { confirmed: true }, 'synthetic-member-token')).resolves.toMatchObject({ alreadyApplied: false });
    expect(invoke.mock.calls[0][1]).toMatchObject({ headers: { 'x-app-session-token': 'synthetic-member-token' }, timeout: 12000 });
    invoke.mockResolvedValue({ data: { ok: true, insuranceSession: { ...insuranceSession, role: 'member' }, alreadyApplied: false }, error: null });
    await expect(platformRequest('enroll_insurance')).rejects.toMatchObject({ code: 'invalid_response' });
    invoke.mockResolvedValue({ data: { ok: true, results: [{ fcId: hospital.id, name: '합성 추천인', affiliation: '합성 소속', code: 'ABCDEFGH' }] }, error: null });
    await expect(platformRequest('search_insurance_referral')).resolves.toMatchObject({ results: [{ name: '합성 추천인' }] });
    invoke.mockResolvedValue({ data: { ok: true, results: [{ fcId: hospital.id }] }, error: null });
    await expect(platformRequest('search_insurance_referral')).rejects.toMatchObject({ code: 'invalid_response' });
    invoke.mockResolvedValue({ data: { ok: true, inviterFcId: hospital.id, inviterName: '합성 추천인', inviterAffiliation: '', referralCode: 'ABCDEFGH' }, error: null });
    await expect(platformRequest('validate_insurance_referral')).resolves.toMatchObject({ inviterFcId: hospital.id });
    invoke.mockResolvedValue({ data: { ok: true, inviterFcId: 'bad' }, error: null });
    await expect(platformRequest('validate_insurance_referral')).rejects.toMatchObject({ code: 'invalid_response' });
    // Family-care referral responses carry the service code and the referrer's name.
    invoke.mockResolvedValue({ data: { ok: true, serviceKey: 'care', code: 'SABCDEF12345', referrer: { name: '합성 추천인', source: 'manual', createdAt: '2026-10-14T00:00:00Z' } }, error: null });
    await expect(platformRequest('get_service_referral')).resolves.toMatchObject({ code: 'SABCDEF12345' });
    invoke.mockResolvedValue({ data: { ok: true, serviceKey: 'care', code: 'ABCDEF123456', referrer: null }, error: null });
    await expect(platformRequest('get_service_referral')).rejects.toMatchObject({ code: 'invalid_response' });
    invoke.mockResolvedValue({ data: { ok: true, serviceKey: 'telecom', referrerName: '합성 추천인' }, error: null });
    await expect(platformRequest('preview_service_referral')).rejects.toMatchObject({ code: 'invalid_response' });
    invoke.mockResolvedValue({ data: { ok: true, serviceKey: 'care', alreadyBound: false }, error: null });
    await expect(platformRequest('bind_service_referral')).resolves.toMatchObject({ alreadyBound: false });
    invoke.mockResolvedValue({ data: { ok: false, code: 'referral_already_bound' }, error: null });
    await expect(platformRequest('bind_service_referral')).rejects.toMatchObject({ code: 'referral_already_bound', message: '이미 등록된 가족간병 추천인은 앱에서 바꿀 수 없어요.' });
  });
  it('validates consumer identity and existing insurance sessions before persistence', async () => {
    const member = { ok: true, memberId: hospital.id, displayName: '합성 회원', residentId: '01000000000', appSessionToken: 'synthetic-consumer-token', role: 'member' };
    invoke.mockResolvedValue({ data: member, error: null });
    expect(await platformRequest('signup')).toEqual(member);
    const insurance = { ok: true, insuranceSession: { ok: true, role: 'fc', residentId: '01000000000', appSessionToken: 'synthetic-fc-token' } };
    invoke.mockResolvedValue({ data: insurance, error: null });
    expect(await platformRequest('login')).toEqual(insurance);
    invoke.mockResolvedValue({ data: { ...member, appSessionToken: null }, error: null });
    await expect(platformRequest('signup')).rejects.toMatchObject({ code: 'invalid_response' });
    invoke.mockResolvedValue({ data: { ok: true, insuranceSession: { ...insurance.insuranceSession, role: 'member' } }, error: null });
    await expect(platformRequest('login')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('keeps explicit consent state and public password recovery within the common endpoint', async () => {
    const account = { ok: true, member: { id: hospital.id, name: '합성 회원', referralCode: 'TEST-CODE', referrerId: null, createdAt: '2026-10-12T00:00:00Z', termsAccepted: true, termsVersion: '2026-10-12' }, applications: [], benefits: [] };
    invoke.mockResolvedValue({ data: account, error: null });
    expect(await platformRequest('get_account', {}, 'synthetic-fc-token')).toEqual(account);
    invoke.mockResolvedValue({ data: { ok: false, code: 'consent_required' }, error: null });
    await expect(platformRequest('get_account', {}, 'synthetic-fc-token')).rejects.toMatchObject({ code: 'consent_required' });
    invoke.mockResolvedValue({ data: { ok: false, code: 'common_membership_withdrawn', message: 'synthetic internal detail' }, error: null });
    await expect(platformRequest('get_account', {}, 'synthetic-fc-token')).rejects.toMatchObject({ code: 'common_membership_withdrawn',
      message: '공통 회원에서 탈퇴한 계정입니다. 다시 가입하려면 동의를 확인해 주세요.' });
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await platformRequest('request_password_reset', { phone: '01000000000' });
    await platformRequest('reset_password', { phone: '01000000000', code: '123456', password: 'Synthetic1!' });
    expect(invoke.mock.calls.slice(-2).every(([, options]) => options.headers === undefined)).toBe(true);
  });
  it.each([
    ['invalid_token', '유효하지'], ['expired_token', '만료'], ['attempts_exhausted', '확인 횟수'],
  ])('offers the matching recovery action for %s', async (code, message) => {
    invoke.mockResolvedValue({ data: { ok: false, code }, error: null });
    await expect(platformRequest('reset_password')).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
  });
});

describe('explicit local hospital demo', () => {
  let request: typeof platformRequest;
  let demoInvoke: jest.Mock;
  beforeAll(() => {
    const previous = process.env.EXPO_PUBLIC_HOSPITAL_DEMO;
    process.env.EXPO_PUBLIC_HOSPITAL_DEMO = 'true';
    jest.isolateModules(() => {
      request = require('../platform-api').platformRequest;
      demoInvoke = require('../supabase').supabase.functions.invoke;
    });
    if (previous === undefined) delete process.env.EXPO_PUBLIC_HOSPITAL_DEMO;
    else process.env.EXPO_PUBLIC_HOSPITAL_DEMO = previous;
  });
  beforeEach(() => demoInvoke.mockReset());
  it('provides offline regions, specialties, featured photos, the real partner and a fictional directory', async () => {
    const regions = await request<PlatformHospitalRegions>('get_hospital_regions');
    const list = await request<PlatformHospitalList>('list_hospitals');
    expect(regions.specialties).toEqual(['한방병원', '정형외과', '안과', '치과', '성형외과', '건강검진센터']);
    expect(regions.regions.find((region) => region.provinceCode === '11')?.districts).toContain('강남구');
    expect(regions.regions.find((region) => region.provinceCode === '43')?.districts).toEqual(['청주시']);
    const [partner, ...samples] = list.hospitals;
    expect(partner).toMatchObject({ id: CARE_HOSPITAL_ID, name: '굿모닝한방병원 청주', address: '충북 청주시 상당구 무심동로 22 방서타워 2~4층', phone: '043-288-0001', photoUrl: 'asset:/partner-exterior.jpg', specialties: ['한방병원'] });
    expect(list.featured[0].id).toBe(CARE_HOSPITAL_ID);
    expect(samples).toHaveLength(12);
    expect(samples.every((item) => item.specialties.length === 1 && regions.specialties.includes(item.specialties[0]))).toBe(true);
    expect(regions.specialties.map((specialty) => samples.filter((item) => item.specialties.includes(specialty)).length)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(list.featured).toHaveLength(5);
    expect(samples.every((item) => item.phone === null && item.websiteUrl === null && item.address?.includes('가상 주소') && item.photoUrl && item.adPlacement === 'regional_list')).toBe(true);
    expect(list.featured.every((item) => item.adPlacement === 'regional_featured')).toBe(true);
    expect(new Set(list.featured.slice(1, 4).map((item) => item.photoUrl)).size).toBe(3);
    expect(new Set(samples.map((item) => item.photoUrl)).size).toBe(3);
    expect(list).toMatchObject({ hasMore: false, nextOffset: null });
    expect(demoInvoke).not.toHaveBeenCalled();
  });
  it('combines province, district, name and specialty filters and returns empty unmatched results', async () => {
    const province = await request<PlatformHospitalList>('list_hospitals', { provinceCode: '11' });
    expect(province.hospitals).toHaveLength(3);
    expect(province.hospitals.every((item) => item.provinceCode === '11')).toBe(true);
    const filtered = await request<PlatformHospitalList>('list_hospitals', { provinceCode: '11', district: '송파구', search: ' 온누리 ', specialty: '정형외과' });
    expect(filtered.hospitals).toHaveLength(1);
    expect(filtered.hospitals[0].name).toBe('온누리정형외과');
    expect(filtered.featured).toHaveLength(1);
    expect((await request<PlatformHospitalList>('list_hospitals', { search: '없는 병원' })).hospitals).toEqual([]);
    expect((await request<PlatformHospitalList>('list_hospitals', { specialty: '내과' })).hospitals).toEqual([]);
    expect(demoInvoke).not.toHaveBeenCalled();
  });
  it('pages without duplicates and opens details with the same embedded image', async () => {
    const first = await request<PlatformHospitalList>('list_hospitals', { limit: 5 });
    const second = await request<PlatformHospitalList>('list_hospitals', { limit: 5, offset: first.nextOffset });
    const last = await request<PlatformHospitalList>('list_hospitals', { limit: 5, offset: second.nextOffset });
    expect(first).toMatchObject({ hasMore: true, nextOffset: 5 });
    expect(second).toMatchObject({ hasMore: true, nextOffset: 10 });
    expect(last).toMatchObject({ hasMore: false, nextOffset: null });
    expect(new Set([...first.hospitals, ...second.hospitals, ...last.hospitals].map((item) => item.id)).size).toBe(13);
    const detail = await request<{ hospital: PlatformHospital }>('get_hospital', { hospitalId: first.hospitals[0].id });
    expect(detail.hospital).toMatchObject({ name: first.hospitals[0].name, photoUrl: first.hospitals[0].photoUrl });
    await expect(request('get_hospital', { hospitalId: '10000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ code: 'hospital_not_found', status: 404 });
    expect(demoInvoke).not.toHaveBeenCalled();
  });
  it('keeps demo events local while other platform actions use the existing transport', async () => {
    await expect(request('record_hospital_event', { hospitalId: hospital.id, eventType: 'detail' })).resolves.toEqual({ ok: true });
    expect(demoInvoke).not.toHaveBeenCalled();
    demoInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await request('apply', { serviceKey: 'care' }, 'synthetic-token');
    expect(demoInvoke).toHaveBeenCalledWith('platform-service', { body: { action: 'apply', serviceKey: 'care' }, headers: { 'x-app-session-token': 'synthetic-token' } });
  });
  it('sends care reservations to the server and validates their responses', async () => {
    const created = { ok: true, requestId: hospital.id, status: 'requested' };
    demoInvoke.mockResolvedValue({ data: created, error: null });
    await expect(request('request_hospital_care', { hospitalId: CARE_HOSPITAL_ID }, 'synthetic-token')).resolves.toEqual(created);
    demoInvoke.mockResolvedValue({ data: { ok: true, requests: [{ id: hospital.id, hospitalId: CARE_HOSPITAL_ID, hospitalName: '굿모닝한방병원 청주',
      desiredStart: '2026-10-21', careType: 'night', contactTime: 'morning', status: 'requested', staffNote: null, respondedAt: null, createdAt: '2026-10-20T00:00:00Z' }] }, error: null });
    await expect(request('list_hospital_care', {}, 'synthetic-token')).rejects.toMatchObject({ code: 'invalid_response' });
    demoInvoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ ok: false, code: 'invalid_details' }), { status: 400 }) } });
    await expect(request('request_hospital_care', {}, 'synthetic-token')).rejects.toMatchObject({ code: 'invalid_details', message: '예약 정보를 확인해 주세요.' });
  });
});

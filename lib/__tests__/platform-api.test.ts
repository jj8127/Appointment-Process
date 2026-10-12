/* eslint-disable @typescript-eslint/no-require-imports */
import { HOSPITAL_DEMO_ENABLED, PlatformApiError, platformRequest, type PlatformHospital, type PlatformHospitalList, type PlatformHospitalRegions } from '../platform-api';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('react-native', () => ({ Image: { resolveAssetSource: (source: number) => ({ uri: `asset:/hospital-${source}.png` }) } }));
jest.mock('@/assets/images/hospital-demo/general-clinic.png', () => 1);
jest.mock('@/assets/images/hospital-demo/dental-clinic.png', () => ({ uri: 'asset:/hospital-2.png' }));
jest.mock('@/assets/images/hospital-demo/clinic-exterior.png', () => 'asset:/hospital-3.png');
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
  it('does not attach a protected token to public directory requests', async () => {
    const response = { ok: true, hospitals: [hospital], featured: [], hasMore: false, nextOffset: null };
    invoke.mockResolvedValue({ data: response, error: null });
    expect(await platformRequest('list_hospitals')).toEqual(response);
    expect(invoke.mock.calls[0][1].headers).toBeUndefined();
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
  it('provides offline regions, specialties, featured photos and a complete fictional directory', async () => {
    const regions = await request<PlatformHospitalRegions>('get_hospital_regions');
    const list = await request<PlatformHospitalList>('list_hospitals');
    expect(regions.specialties.length).toBeGreaterThanOrEqual(8);
    expect(regions.regions.find((region) => region.provinceCode === '11')?.districts).toContain('강남구');
    expect(list.hospitals).toHaveLength(12);
    expect(list.featured).toHaveLength(5);
    expect(list.hospitals.every((item) => item.phone === null && item.websiteUrl === null && item.address?.includes('가상 주소') && item.photoUrl && item.adPlacement === 'regional_list')).toBe(true);
    expect(list.featured.every((item) => item.adPlacement === 'regional_featured')).toBe(true);
    expect(new Set(list.featured.slice(0, 3).map((item) => item.photoUrl)).size).toBe(3);
    expect(new Set(list.hospitals.map((item) => item.photoUrl)).size).toBe(3);
    expect(list).toMatchObject({ hasMore: false, nextOffset: null });
    expect(demoInvoke).not.toHaveBeenCalled();
  });
  it('combines province, district, name and specialty filters and returns empty unmatched results', async () => {
    const province = await request<PlatformHospitalList>('list_hospitals', { provinceCode: '11' });
    expect(province.hospitals).toHaveLength(3);
    expect(province.hospitals.every((item) => item.provinceCode === '11')).toBe(true);
    const filtered = await request<PlatformHospitalList>('list_hospitals', { provinceCode: '11', district: '송파구', search: ' 온누리 ', specialty: '재활의학과' });
    expect(filtered.hospitals).toHaveLength(1);
    expect(filtered.hospitals[0].name).toBe('온누리정형외과');
    expect(filtered.featured).toHaveLength(1);
    expect((await request<PlatformHospitalList>('list_hospitals', { search: '없는 병원' })).hospitals).toEqual([]);
    expect(demoInvoke).not.toHaveBeenCalled();
  });
  it('pages without duplicates and opens details with the same embedded image', async () => {
    const first = await request<PlatformHospitalList>('list_hospitals', { limit: 5 });
    const second = await request<PlatformHospitalList>('list_hospitals', { limit: 5, offset: first.nextOffset });
    const last = await request<PlatformHospitalList>('list_hospitals', { limit: 5, offset: second.nextOffset });
    expect(first).toMatchObject({ hasMore: true, nextOffset: 5 });
    expect(second).toMatchObject({ hasMore: true, nextOffset: 10 });
    expect(last).toMatchObject({ hasMore: false, nextOffset: null });
    expect(new Set([...first.hospitals, ...second.hospitals, ...last.hospitals].map((item) => item.id)).size).toBe(12);
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
});

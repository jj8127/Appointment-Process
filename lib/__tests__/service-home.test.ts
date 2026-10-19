import {
  hasInsuranceHomeContext,
  resolveInsuranceServiceRoute,
  resolveServiceInformationKey,
} from '@/lib/service-home';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';

describe('service home entry policy', () => {
  const guest = { role: null, hydrated: true, isRequestBoardDesigner: false } as const;
  it('waits for hydration and uses login for guests', () => {
    expect(resolveInsuranceServiceRoute({ ...guest, hydrated: false })).toBeNull();
    expect(resolveInsuranceServiceRoute(guest)).toBe('/services/login?service=insurance');
  });
  it('allows a signed common member to register service information without an FC role', () => {
    expect(resolveInsuranceServiceRoute({ ...guest, isPlatformSignedIn: true })).toEqual({
      pathname: '/apply-gate', params: { next: '/?mode=insurance' },
    });
  });
  it('delegates FC identity checks to the existing apply gate', () => {
    expect(resolveInsuranceServiceRoute({ ...guest, role: 'fc' })).toEqual({
      pathname: '/apply-gate', params: { next: '/?mode=insurance' },
    });
  });
  it('keeps administrator and designer destinations distinct', () => {
    expect(resolveInsuranceServiceRoute({ ...guest, role: 'admin' })).toBe('/?mode=insurance');
    expect(resolveInsuranceServiceRoute({ ...guest, role: 'fc', isRequestBoardDesigner: true })).toBe('/request-board');
  });
  it.each(['insurance', 'onboarding', 'exam'])('preserves explicit %s insurance home links', (mode) => {
    expect(hasInsuranceHomeContext({ mode })).toBe(true);
  });
  it('preserves notification receipts independently of the home mode', () => {
    expect(hasInsuranceHomeContext({ notificationId: 'fictional-receipt' })).toBe(true);
    expect(hasInsuranceHomeContext({ notificationTarget: 'fictional-home-target' })).toBe(true);
    expect(hasInsuranceHomeContext({ mode: 'unknown', notificationId: ' ' })).toBe(false);
  });
  it('does not treat arbitrary or repeated mode values as an insurance home request', () => {
    expect(hasInsuranceHomeContext({})).toBe(false);
    expect(hasInsuranceHomeContext({ mode: 'admin' })).toBe(false);
    expect(hasInsuranceHomeContext({ mode: ['insurance', 'exam'] })).toBe(false);
  });
  it('has an explicit public navigation surface without changing protected presets', () => {
    const preset = resolveBottomNavPreset({ ...guest, hydrated: false }, { surface: 'service-hub' });
    expect(preset).toBe('service-hub');
    expect(resolveBottomNavActiveKey(preset, 'activity')).toBe('activity');
    expect(resolveBottomNavPreset({ role: 'admin', readOnly: true, hydrated: true })).toBe('manager');
    expect(resolveBottomNavPreset(guest)).toBeNull();
  });
  it('only accepts known information routes', () => {
    expect(resolveServiceInformationKey('care')).toBe('care');
    expect(resolveServiceInformationKey('telecom')).toBe('telecom');
    expect(resolveServiceInformationKey('car')).toBe('car');
    expect(resolveServiceInformationKey('rental')).toBe('rental');
    expect(resolveServiceInformationKey('hospital')).toBe('hospital');
    expect(resolveServiceInformationKey('help')).toBe('help');
    expect(resolveServiceInformationKey('insurance')).toBe('insurance');
    expect(resolveServiceInformationKey(['care'])).toBeNull();
  });
});

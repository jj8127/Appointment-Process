import { parseLoginSuccessResponse } from '@/lib/login-response-contract';

const base = {
  ok: true,
  role: 'fc',
  residentId: '01012345678',
  displayName: '홍길동',
  requestBoardRole: 'fc',
  appSessionToken: 'signed-session-token',
};

describe('login success response contract', () => {
  it('accepts complete role-specific success responses', () => {
    expect(parseLoginSuccessResponse(base, base.residentId)).toMatchObject({
      role: 'fc',
      staffType: null,
      requestBoardRole: 'fc',
    });
    expect(parseLoginSuccessResponse({
      ...base,
      role: 'manager',
    }, base.residentId)).toMatchObject({ role: 'manager', requestBoardRole: 'fc' });
    expect(parseLoginSuccessResponse({
      ...base,
      role: 'admin',
      staffType: 'admin',
      requestBoardRole: null,
    }, base.residentId)).toMatchObject({ role: 'admin', staffType: 'admin' });
    expect(parseLoginSuccessResponse({
      ...base,
      role: 'admin',
      staffType: 'developer',
      requestBoardRole: 'fc',
    }, base.residentId)).toMatchObject({ role: 'admin', staffType: 'developer' });
  });

  it.each([
    ['missing role', { ...base, role: undefined }],
    ['mismatched resident id', { ...base, residentId: '01099999999' }],
    ['missing display name', { ...base, displayName: '' }],
    ['missing app session token', { ...base, appSessionToken: undefined }],
    ['invalid FC board role', { ...base, requestBoardRole: null }],
    ['invalid developer board role', {
      ...base, role: 'admin', staffType: 'developer', requestBoardRole: null,
    }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseLoginSuccessResponse(payload, base.residentId)).toThrow('로그인 응답');
  });
});

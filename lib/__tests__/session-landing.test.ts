import { resolveSessionLandingRoute } from '@/lib/session-landing';

describe('resolveSessionLandingRoute', () => {
  it('routes admins to the admin home by default', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'admin',
        residentId: '01058006018',
        isRequestBoardDesigner: false,
      }),
    ).toBe('/');
  });

  it('routes request-board designers to request-board first', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '01051078127',
        isRequestBoardDesigner: true,
      }),
    ).toBe('/request-board');
  });

  it('routes FC users with a resident id to home-lite first', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '01051078127',
        isRequestBoardDesigner: false,
      }),
    ).toBe('/home-lite');
  });

  it('waits when an FC session is still missing its resident id', () => {
    expect(
      resolveSessionLandingRoute({
        role: 'fc',
        residentId: '',
        isRequestBoardDesigner: false,
      }),
    ).toBeNull();
  });
});

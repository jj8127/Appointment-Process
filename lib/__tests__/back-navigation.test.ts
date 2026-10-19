import { goBackOrReplace, resetTo, returnTo } from '@/lib/back-navigation';

describe('goBackOrReplace', () => {
  it('uses router.back when the stack can go back', () => {
    const router = {
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
    };

    goBackOrReplace(router, '/');

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to router.replace when there is no back stack', () => {
    const router = {
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
    };

    goBackOrReplace(router, '/messenger');

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/messenger');
  });
});

describe('resetTo', () => {
  it('clears the stack before opening the destination so back cannot revisit signed-out screens', () => {
    const calls: string[] = [];
    const router = {
      back: jest.fn(),
      canDismiss: jest.fn(() => true),
      dismissAll: jest.fn(() => calls.push('dismissAll')),
      replace: jest.fn(() => calls.push('replace')),
    };

    resetTo(router, '/login?skipAuto=1');

    expect(calls).toEqual(['dismissAll', 'replace']);
    expect(router.replace).toHaveBeenCalledWith('/login?skipAuto=1');
  });

  it('only replaces when there is nothing to dismiss', () => {
    const router = { back: jest.fn(), canDismiss: jest.fn(() => false), dismissAll: jest.fn(), replace: jest.fn() };

    resetTo(router, '/');

    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

describe('returnTo', () => {
  it('goes back to a parent already in the history instead of stacking another copy', () => {
    const router = { back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };

    returnTo(router, '/request-board');

    expect(router.dismissTo).toHaveBeenCalledWith('/request-board');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to replace when the router cannot dismiss to a route', () => {
    const router = { back: jest.fn(), replace: jest.fn() };

    returnTo(router, '/');

    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

import { goBackOrReplace } from '@/lib/back-navigation';

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

import {
  buildStoredSignupReferral,
  getSignupReferralSelectionError,
  runSinglePendingReferralApply,
} from '../signup-referral';

describe('buildStoredSignupReferral', () => {
  test('does not persist a pasted referral code until the user selects a search result', () => {
    expect(
      buildStoredSignupReferral({
        selectedReferral: null,
        referralStatus: 'idle',
        referralInviterName: '',
        referralInviterFcId: null,
      }),
    ).toEqual({
      recommender: '',
    });
  });

  test('persists the selected referral code after the chosen result is validated', () => {
    expect(
      buildStoredSignupReferral({
        selectedReferral: {
          fcId: 'fc-1',
          name: '문주화',
          affiliation: '1본부 서선미',
          code: 'kcsaczxu',
        },
        referralStatus: 'valid',
        referralInviterName: '문주화',
        referralInviterFcId: 'fc-1',
      }),
    ).toEqual({
      recommender: '문주화',
      referralCode: 'KCSACZXU',
      referralInviterFcId: 'fc-1',
    });
  });

  test('drops the referral payload when the selected result has no active code', () => {
    expect(
      buildStoredSignupReferral({
        selectedReferral: {
          fcId: 'fc-1',
          name: '문주화',
          affiliation: '1본부 서선미',
          code: null,
        },
        referralStatus: 'valid',
        referralInviterName: '문주화',
        referralInviterFcId: 'fc-1',
      }),
    ).toEqual({
      recommender: '',
    });
  });

  test('requires the user to pick a search result before continuing when the single input is filled', () => {
    expect(getSignupReferralSelectionError('KCSACZXU', null)).toBe(
      '추천인을 적용하려면 검색 결과에서 한 명을 선택하거나 입력값을 지워주세요.',
    );
  });

  test('does not require a selection when the single input is empty or already resolved', () => {
    expect(getSignupReferralSelectionError('', null)).toBeNull();
    expect(
      getSignupReferralSelectionError('문주화', {
        fcId: 'fc-1',
        name: '문주화',
        affiliation: '1본부 서선미',
        code: 'KCSACZXU',
      }),
    ).toBeNull();
  });
});

describe('runSinglePendingReferralApply', () => {
  test('reuses the in-flight pending referral apply instead of queueing a second run', async () => {
    const state = { promise: null as Promise<void> | null };
    const control: { resolve: () => void } = {
      resolve: () => {
        throw new Error('expected resolver to be assigned');
      },
    };
    const start = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          control.resolve = resolve;
        }),
    );

    const firstRun = runSinglePendingReferralApply(state, start);
    const secondRun = runSinglePendingReferralApply(state, start);

    expect(start).toHaveBeenCalledTimes(1);
    expect(secondRun).toBe(firstRun);

    control.resolve();
    await firstRun;

    const thirdRun = runSinglePendingReferralApply(state, async () => {});
    await thirdRun;

    expect(state.promise).toBeNull();
  });
});

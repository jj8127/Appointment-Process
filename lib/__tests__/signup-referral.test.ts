import {
  buildStoredSignupReferral,
  getSignupReferralSelectionError,
  hasValidStoredSignupReferral,
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
      '추천인을 적용하려면 검색 결과에서 한 명을 선택해주세요.',
    );
  });

  test('requires a selected referral even when the search input is empty', () => {
    expect(getSignupReferralSelectionError('', null)).toBe('추천인을 검색해 선택해주세요.');
  });

  test('accepts an already resolved selection', () => {
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

describe('hasValidStoredSignupReferral', () => {
  test('requires the validated code, inviter id, and display name carried from signup', () => {
    expect(hasValidStoredSignupReferral({
      recommender: '문주화',
      referralCode: 'KCSACZXU',
      referralInviterFcId: 'fc-1',
    })).toBe(true);

    expect(hasValidStoredSignupReferral({
      recommender: '',
      referralCode: 'KCSACZXU',
      referralInviterFcId: 'fc-1',
    })).toBe(false);
    expect(hasValidStoredSignupReferral({
      recommender: '문주화',
      referralCode: undefined,
      referralInviterFcId: 'fc-1',
    })).toBe(false);
    expect(hasValidStoredSignupReferral({
      recommender: '문주화',
      referralCode: 'KCSACZXU',
      referralInviterFcId: undefined,
    })).toBe(false);
  });
});

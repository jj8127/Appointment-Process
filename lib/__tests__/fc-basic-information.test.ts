import {
  buildFcBasicInformationFormValues,
  buildFcBasicInformationPatch,
  type FcBasicInformationProfile,
} from '../fc-basic-information';

const profile = (overrides: Partial<FcBasicInformationProfile> = {}): FcBasicInformationProfile => ({
  id: 'fc-profile-id',
  affiliation: '1본부 홍길동',
  name: '기존 이름',
  phone: '01012345678',
  recommender: '추천인',
  email: 'before@example.com',
  temp_id: 'T-100',
  carrier: 'SKT',
  address: '서울시 중구',
  address_detail: '101호',
  resident_id_masked: '900101-*******',
  signup_completed: true,
  ...overrides,
});

describe('FC basic-information edit contract', () => {
  it('hydrates every supported field from the canonical existing profile', () => {
    expect(buildFcBasicInformationFormValues(profile())).toEqual({
      affiliation: '1본부 홍길동',
      name: '기존 이름',
      phone: '01012345678',
      email: 'before@example.com',
      carrier: 'SKT',
      address: '서울시 중구',
      addressDetail: '101호',
      residentFront: '',
      residentBack: '',
    });
  });

  it('sends only the changed editable value and preserves untouched profile state', () => {
    const current = profile();
    const next = buildFcBasicInformationFormValues(current);

    expect(buildFcBasicInformationPatch(current, {
      ...next,
      name: '수정 이름',
    })).toEqual({ name: '수정 이름' });
  });

  it('lets a legacy partial profile update one populated field without filling missing fields', () => {
    const current = profile({ email: null, carrier: null });
    const next = buildFcBasicInformationFormValues(current);

    expect(buildFcBasicInformationPatch(current, {
      ...next,
      name: '수정 이름',
    })).toEqual({ name: '수정 이름' });
  });

  it('never includes phone, recommender, workflow, or identity fields in the base-profile patch', () => {
    const current = profile();

    expect(buildFcBasicInformationPatch(current, {
      ...buildFcBasicInformationFormValues(current),
      phone: '01099999999',
      address: '부산시 중구',
      addressDetail: '202호',
    })).toEqual({});
  });
});

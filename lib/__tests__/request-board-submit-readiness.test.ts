import {
  buildRequestReadiness,
  describeRequestFanOut,
  firstRequestBlocker,
} from '@/lib/request-board-submit-readiness';

const ready = {
  drivingStatus: 'other',
  productCount: 1,
  requestText: '갱신형 위주로 비교 부탁드립니다',
  designerCount: 1,
  companiesMissingFcCode: [] as string[],
};

describe('request board submit readiness', () => {
  it('lists every check in screen order and lets a complete request through', () => {
    const items = buildRequestReadiness(ready);
    expect(items.map((item) => item.key)).toEqual(['driving', 'product', 'request', 'designer', 'fcCode']);
    expect(items.every((item) => item.ok === true)).toBe(true);
    expect(items[0].detail).toBe('기타');
    expect(buildRequestReadiness({ ...ready, drivingStatus: '자가용' })[0].detail).toBe('자가용');
    expect(firstRequestBlocker(items)).toBeNull();
  });

  it('names the first blocker so the submit button can say what to do next', () => {
    const blocker = firstRequestBlocker(buildRequestReadiness({ ...ready, drivingStatus: ' ', productCount: 0 }));
    expect(blocker).toMatchObject({ key: 'driving', action: '운전구분을 선택해주세요' });
    expect(firstRequestBlocker(buildRequestReadiness({ ...ready, requestText: '   ' }))?.key).toBe('request');
  });

  it('checks FC codes only after a manager is chosen and names the missing companies once', () => {
    const before = buildRequestReadiness({ ...ready, designerCount: 0 });
    expect(before.find((item) => item.key === 'fcCode')).toMatchObject({ ok: null, detail: '설계매니저 선택 후 확인' });
    expect(firstRequestBlocker(before)?.key).toBe('designer');

    const missing = buildRequestReadiness({ ...ready, designerCount: 2, companiesMissingFcCode: ['삼성생명', '삼성생명', 'DB손보'] });
    expect(missing.find((item) => item.key === 'fcCode')).toMatchObject({ ok: false, detail: '삼성생명, DB손보 코드 필요' });
    expect(firstRequestBlocker(missing)?.action).toBe('설계코드를 등록해주세요');
  });

  it('explains when one submit creates several requests', () => {
    expect(describeRequestFanOut(1, 1)).toBeNull();
    expect(describeRequestFanOut(2, 2)).toBe('상품 2 × 설계매니저 2 = 의뢰 4건');
  });
});

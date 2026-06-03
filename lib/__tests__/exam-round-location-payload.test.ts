import {
  buildExamRoundLocationRows,
  hasExamRoundLocationsForSave,
} from '../exam-round-location-payload';

describe('exam round location payload', () => {
  it('includes the pending location input when saving a round', () => {
    expect(
      buildExamRoundLocationRows({
        draftLocations: [],
        pendingLocationName: ' 서울 ',
        pendingLocationOrder: '2',
      }),
    ).toEqual([{ location_name: '서울', sort_order: 2 }]);
  });

  it('keeps committed draft locations and appends a pending location', () => {
    expect(
      buildExamRoundLocationRows({
        draftLocations: [{ id: 'draft-1', name: '부산', order: 1 }],
        pendingLocationName: '대구',
        pendingLocationOrder: 3,
      }),
    ).toEqual([
      { location_name: '부산', sort_order: 1 },
      { location_name: '대구', sort_order: 3 },
    ]);
  });

  it('trims names, ignores blanks, and defaults invalid sort orders', () => {
    expect(
      buildExamRoundLocationRows({
        draftLocations: [
          { id: 'blank', name: '   ', order: 7 },
          { id: 'valid', name: ' 인천 ', order: Number.NaN },
        ],
        pendingLocationName: '   ',
        pendingLocationOrder: 'bad-order',
      }),
    ).toEqual([{ location_name: '인천', sort_order: 0 }]);
  });

  it('deduplicates draft and pending locations by normalized name', () => {
    expect(
      buildExamRoundLocationRows({
        draftLocations: [{ id: 'draft-1', name: '광주', order: 4 }],
        pendingLocationName: ' 광주 ',
        pendingLocationOrder: 8,
      }),
    ).toEqual([{ location_name: '광주', sort_order: 4 }]);
  });

  it('requires at least one existing or new location before saving', () => {
    expect(hasExamRoundLocationsForSave(0, [])).toBe(false);
    expect(
      hasExamRoundLocationsForSave(0, [{ location_name: '서울', sort_order: 1 }]),
    ).toBe(true);
    expect(hasExamRoundLocationsForSave(2, [])).toBe(true);
  });
});

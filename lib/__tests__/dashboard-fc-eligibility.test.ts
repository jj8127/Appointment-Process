import {
  buildActiveManagerPhoneSet,
  isDashboardFcOnlyRow,
} from '../../web/src/lib/dashboard-fc-eligibility';

describe('dashboard FC-only eligibility', () => {
  it('excludes active manager identities even when their affiliation looks like an FC headquarters', () => {
    const activeManagerPhones = buildActiveManagerPhoneSet([
      { phone: '010-1111-2222' },
    ]);

    expect(
      isDashboardFcOnlyRow(
        {
          affiliation: '1본부',
          phone: '01011112222',
        },
        activeManagerPhones,
      ),
    ).toBe(false);
  });

  it('excludes designer affiliations with or without whitespace', () => {
    expect(
      isDashboardFcOnlyRow(
        { affiliation: '한화 설계 매니저', phone: '01033334444' },
        new Set(),
      ),
    ).toBe(false);
  });

  it('keeps a completed FC identity outside the active manager set', () => {
    expect(
      isDashboardFcOnlyRow(
        { affiliation: '2본부', phone: '01055556666' },
        new Set(),
      ),
    ).toBe(true);
  });
});

import { parseDesignerCompanyNameFromAffiliation } from '../request-board-auth';

describe('request_board designer affiliation contract', () => {
  it('derives the designer company from the GaramIn bootstrap affiliation marker', () => {
    expect(parseDesignerCompanyNameFromAffiliation('동양생명 설계매니저')).toBe('동양생명');
    expect(parseDesignerCompanyNameFromAffiliation(' 롯데손보: 설계매니저 ')).toBe('롯데손보');
  });

  it('does not classify ordinary FC affiliations as request_board designers', () => {
    expect(parseDesignerCompanyNameFromAffiliation('동양생명')).toBeNull();
    expect(parseDesignerCompanyNameFromAffiliation('1본부 김형수')).toBeNull();
    expect(parseDesignerCompanyNameFromAffiliation(null)).toBeNull();
  });
});

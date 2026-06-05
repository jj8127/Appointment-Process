import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('request-board mobile UI contracts', () => {
  const fcCodesSource = readFileSync(join(process.cwd(), 'app/request-board-fc-codes.tsx'), 'utf8');
  const createSource = readFileSync(join(process.cwd(), 'app/request-board-create.tsx'), 'utf8');

  it('keeps the 설계코드 회사명 suggestions scrollable instead of limiting them to six rows', () => {
    const filteredCompanyNamesBlock = fcCodesSource.slice(
      fcCodesSource.indexOf('const filteredCompanyNames = useMemo'),
      fcCodesSource.indexOf('const existingForInsurer = useMemo'),
    );

    expect(filteredCompanyNamesBlock).not.toContain('slice(0, 6)');
    expect(fcCodesSource).toContain('nestedScrollEnabled');
    expect(fcCodesSource).toContain('maxHeight: 300');
  });

  it('does not dismiss the 신규 고객 등록 keyboard when the user drags the form to scroll', () => {
    const mainScrollBlock = createSource.slice(
      createSource.indexOf('<KeyboardAvoidingView'),
      createSource.indexOf('<DesignerBottomSheet'),
    );

    expect(mainScrollBlock).toContain('keyboardShouldPersistTaps="always"');
    expect(mainScrollBlock).toContain('keyboardDismissMode="none"');
    expect(mainScrollBlock).not.toContain('keyboardDismissMode="on-drag"');
  });
});

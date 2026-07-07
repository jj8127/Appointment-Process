import { formatRequestBoardCustomerDisplayName } from '@/lib/request-board-policyholder-display';

describe('request board policyholder display', () => {
  it('uses the insured customer name when policyholder is the same or missing', () => {
    expect(
      formatRequestBoardCustomerDisplayName({
        customerName: '김가람',
        hasSeparatePolicyholder: false,
        policyholderName: '박계약',
      }),
    ).toBe('김가람');

    expect(
      formatRequestBoardCustomerDisplayName({
        customerName: '김가람',
        hasSeparatePolicyholder: true,
        policyholderName: '',
      }),
    ).toBe('김가람');
  });

  it('shows separate policyholder context when contractor and insured are different', () => {
    expect(
      formatRequestBoardCustomerDisplayName({
        customerName: '김피보험',
        hasSeparatePolicyholder: true,
        policyholderName: '박계약',
      }),
    ).toBe('김피보험 (계약자: 박계약)');
  });
});

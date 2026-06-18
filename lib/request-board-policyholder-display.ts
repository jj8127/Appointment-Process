type RequestBoardCustomerDisplayInput = {
  customerName?: string | null;
  hasSeparatePolicyholder?: boolean | null;
  policyholderName?: string | null;
};

const normalizeDisplayName = (value?: string | null) => String(value ?? '').trim();

export const formatRequestBoardCustomerDisplayName = ({
  customerName,
  hasSeparatePolicyholder,
  policyholderName,
}: RequestBoardCustomerDisplayInput): string => {
  const customer = normalizeDisplayName(customerName) || '-';
  const policyholder = normalizeDisplayName(policyholderName);

  if (!hasSeparatePolicyholder || !policyholder) {
    return customer;
  }

  return `${customer} (계약자 ${policyholder})`;
};

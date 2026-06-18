import { readFileSync } from 'node:fs';

describe('request board mobile API wrapper contract', () => {
  const source = readFileSync('lib/request-board-api.ts', 'utf8');

  it('exposes FC-side customer, product, and request creation wrappers', () => {
    expect(source).toContain('export async function rbGetCustomers');
    expect(source).toContain("rbFetch<RbCustomerProfile[]>('/api/customers')");
    expect(source).toContain('export async function rbSaveCustomer');
    expect(source).toContain("rbFetch<RbCustomerProfile>('/api/customers'");
    expect(source).toContain('export async function rbGetProducts');
    expect(source).toContain("rbFetch<RbInsuranceProduct[]>('/api/designers/products/list')");
    expect(source).toContain('export async function rbCreateRequest');
    expect(source).toContain("rbFetch<RbRequestDetail>('/api/requests'");
  });

  it('exposes designer-side direct action wrappers against current GaramLink endpoints', () => {
    expect(source).toContain('export async function rbAcceptRequest');
    expect(source).toContain("`/api/requests/${requestId}/designers/${designerId}/accept`");
    expect(source).toContain('export async function rbRejectRequest');
    expect(source).toContain("`/api/requests/${requestId}/designers/${designerId}/reject`");
    expect(source).toContain('export async function rbCompleteRequest');
    expect(source).toContain("`/api/requests/${requestId}/designers/${designerId}/complete`");
    expect(source).toContain('export async function rbUploadRequestAttachments');
    expect(source).toContain('/api/requests/${requestId}/designers/${designerId}/attachments');
  });

  it('keeps mobile request reads unmasked for design work details', () => {
    expect(source).toContain('/api/requests?limit=100&page=1&ssnView=full');
    expect(source).toContain('/api/requests/${id}?ssnView=full');
  });

  it('uses the server field names for per-designer FC code selections', () => {
    expect(source).toContain('fcCodeName?: string | null');
    expect(source).toContain('fcCodeValue?: string | null');
    expect(source).toContain('fcCompanyCodeId?: number | null');
    expect(source).toContain('code_name?: string | null');
  });

  it('keeps separate policyholder fields in create payloads and request detail reads', () => {
    expect(source).toContain('hasSeparatePolicyholder?: boolean');
    expect(source).toContain('policyholderName?: string');
    expect(source).toContain('policyholderSsn?: string');
    expect(source).toContain('policyholderPhone?: string');
    expect(source).toContain('policyholderCarrier?: string');
    expect(source).toContain('policyholderAddress?: string');

    expect(source).toContain('has_separate_policyholder?: boolean | null');
    expect(source).toContain('policyholder_name?: string | null');
    expect(source).toContain('policyholder_ssn?: string | null');
    expect(source).toContain('policyholder_phone?: string | null');
    expect(source).toContain('policyholder_carrier?: string | null');
    expect(source).toContain('policyholder_address?: string | null');
  });
});

import { readFileSync } from 'node:fs';

describe('request board mobile API wrapper contract', () => {
  const source = readFileSync('lib/request-board-api.ts', 'utf8');

  it('exposes FC-side customer, product, and request creation wrappers', () => {
    expect(source).toContain('export async function rbGetCustomers');
    expect(source).toContain("rbFetch<RbCustomerProfile[]>('/api/customers?ssnView=full')");
    expect(source).toContain('export async function rbSaveCustomer');
    expect(source).toContain("rbFetch<RbCustomerProfile>('/api/customers'");
    expect(source).toContain('export async function rbGetProducts');
    expect(source).toContain("rbFetch<RbInsuranceProduct[]>('/api/designers/products/list')");
    expect(source).toContain('export async function rbCreateRequest');
    expect(source).toContain("rbFetch<RbRequestDetail>('/api/requests'");
  });

  it('gives only request creation enough time for response-bound notification fanout', () => {
    expect(source).toContain('const REQUEST_BOARD_FETCH_TIMEOUT_MS = 8000;');
    expect(source).toContain('const REQUEST_BOARD_NOTIFICATION_WRITE_TIMEOUT_MS = 30000;');

    const fetchHelper = source.slice(
      source.indexOf('type RbFetchOptions'),
      source.indexOf('/* ─── Auth ─── */'),
    );
    expect(fetchHelper).toContain('timeoutMs = REQUEST_BOARD_FETCH_TIMEOUT_MS');
    expect(fetchHelper).toContain('...requestOptions');
    expect(fetchHelper).toContain('}, timeoutMs);');

    const createRequest = source.slice(
      source.indexOf('export async function rbCreateRequest'),
      source.indexOf('export async function rbGetRequestList'),
    );
    expect(createRequest).toContain('timeoutMs: REQUEST_BOARD_NOTIFICATION_WRITE_TIMEOUT_MS');
    expect(source.match(/REQUEST_BOARD_NOTIFICATION_WRITE_TIMEOUT_MS/g)).toHaveLength(2);
  });

  it('keeps mobile customer update/delete aligned with GaramLink customer endpoints', () => {
    expect(source).toContain('export type RbSaveCustomerPayload');
    expect(source).toContain('id?: number;');
    expect(source).toContain('export async function rbDeleteCustomer');
    expect(source).toContain('`/api/customers/${id}`');
    expect(source).toContain("method: 'DELETE'");
  });

  it('keeps local GaramLink API development port aligned with the request_board server', () => {
    const urlSource = readFileSync('lib/request-board-url.ts', 'utf8');

    expect(urlSource).toContain("const REQUEST_BOARD_DEV_API_PORT = '3001'");
    expect(urlSource).toContain("const REQUEST_BOARD_DEV_WEB_PORT = '5173'");
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

  it('keeps list reads lightweight while preserving full design-work detail reads', () => {
    expect(source).toContain(
      '/api/requests?limit=100&page=1&ssnView=masked&includeAttachments=false',
    );
    expect(source).toContain('/api/requests/${id}?ssnView=full');
  });

  it('does not turn request-board access-denied bridge errors into full GaramIn re-login', () => {
    const authBlock = source.slice(
      source.indexOf('export async function rbCheckAuth'),
      source.indexOf('/* ─── Conversations'),
    );

    expect(authBlock).toContain('REQUEST_BOARD_APP_RELOGIN_ERROR_CODES');
    expect(authBlock).not.toContain("bridged.errorCode === 'request_board_not_applicable'");
    expect(authBlock).not.toContain("bridged.errorCode === 'inactive_account'");
    expect(authBlock).not.toContain("bridged.errorCode === 'not_completed'");
  });

  it('uses the server field names for per-designer FC code selections', () => {
    expect(source).toContain('fcCodeName?: string | null');
    expect(source).toContain('fcCodeValue?: string | null');
    expect(source).toContain('fcCompanyCodeId?: number | null');
    expect(source).toContain('code_name?: string | null');
  });
  it('keeps FC code snapshots available on request list items', () => {
    const listItemBlock = source.slice(
      source.indexOf('export type RbRequestListItem'),
      source.indexOf('export type RbRequestDetail'),
    );

    expect(listItemBlock).toContain('fc_code_name?: string | null');
    expect(listItemBlock).toContain('fc_code_value?: string | null');
    expect(listItemBlock).toContain('fc?: {');
    expect(listItemBlock).toContain('phone?: string | null');
    expect(listItemBlock).toContain('fc_company_code_id?: number | null');
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

  it('keeps the hospitalization field alias explicit across customer and request payloads', () => {
    expect(source).toContain('recentHospitalization?: string');
    expect(source).toContain('hospitalizationHistory?: string');
    expect(source).toContain('recentHospitalization: payload.recentHospitalization');
    expect(source).toContain('hospitalizationHistory: payload.hospitalizationHistory');
  });
});

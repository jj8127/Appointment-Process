import {
  canCreateRequestBoardRequest,
  getRequestBoardCustomerManagementRoute,
  resolveRequestBoardCreateInitialStep,
  resolveRequestBoardCreateBackTarget,
  resolveRequestBoardCreateVisibleSteps,
} from '@/lib/request-board-create-flow';

describe('request board create flow', () => {
  it('allows FC request-board sessions to create requests', () => {
    expect(canCreateRequestBoardRequest({
      role: 'fc',
      requestBoardRole: 'fc',
      isRequestBoardDesigner: false,
    })).toBe(true);
  });

  it('blocks designer request-board sessions from the FC create screen', () => {
    expect(canCreateRequestBoardRequest({
      role: 'fc',
      requestBoardRole: 'designer',
      isRequestBoardDesigner: true,
    })).toBe(false);
  });

  it('blocks read-only admin-derived FC bridge sessions from write-only create actions', () => {
    const readOnlyAdminBridgeFcSession = {
      role: 'admin',
      readOnly: true,
      staffType: null,
      requestBoardRole: 'fc',
      isRequestBoardDesigner: false,
    } as const;

    expect(canCreateRequestBoardRequest(readOnlyAdminBridgeFcSession)).toBe(false);
  });

  it('returns to the previous step while composing', () => {
    expect(resolveRequestBoardCreateBackTarget('compose', 'newCustomer')).toEqual({
      type: 'step',
      step: 'newCustomer',
    });
  });

  it('exits to request list after a sent request instead of reopening the draft', () => {
    expect(resolveRequestBoardCreateBackTarget('sent', 'customer')).toEqual({
      type: 'replace',
      path: '/request-board-requests',
    });
  });

  it('routes customer management into the customer step of the create flow', () => {
    expect(getRequestBoardCustomerManagementRoute()).toEqual({
      pathname: '/request-board-create',
      params: {
        entry: 'customer',
        source: 'customer-management',
      },
    });
  });

  it('normalizes create-flow entry query params to a safe first step', () => {
    expect(resolveRequestBoardCreateInitialStep('newCustomer')).toBe('newCustomer');
    expect(resolveRequestBoardCreateInitialStep(['customer', 'newCustomer'])).toBe('customer');
    expect(resolveRequestBoardCreateInitialStep('compose')).toBe('customer');
    expect(resolveRequestBoardCreateInitialStep(undefined)).toBe('customer');
  });

  it('hides request wizard steps for the customer management entry', () => {
    expect(resolveRequestBoardCreateVisibleSteps('customer', 'customer-management')).toEqual([]);
    expect(resolveRequestBoardCreateVisibleSteps(['customer'], ['customer-management'])).toEqual([]);
  });

  it('keeps all request wizard steps for normal request creation', () => {
    expect(resolveRequestBoardCreateVisibleSteps(undefined, undefined)).toEqual([
      'customer',
      'newCustomer',
      'compose',
      'sent',
    ]);
  });
});

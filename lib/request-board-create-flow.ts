import {
  canUseRequestBoardAsFc,
  type RequestBoardPermissionInput,
} from './request-board-permissions';

export type RequestBoardCreateStep = 'customer' | 'newCustomer' | 'compose' | 'sent';
export type RequestBoardCreateEntryStep = Extract<RequestBoardCreateStep, 'customer' | 'newCustomer'>;
export type RequestBoardCreateEntryParam = string | string[] | null | undefined;
export type RequestBoardCreateSourceParam = string | string[] | null | undefined;

const REQUEST_CREATE_STEPS: RequestBoardCreateStep[] = ['customer', 'newCustomer', 'compose', 'sent'];

export type RequestBoardCreateBackTarget =
  | { type: 'back' }
  | { type: 'step'; step: RequestBoardCreateStep }
  | { type: 'replace'; path: '/request-board-requests' };

export function getRequestBoardCustomerManagementRoute() {
  return {
    pathname: '/request-board-create',
    params: {
      entry: 'customer',
      source: 'customer-management',
    },
  } as const;
}

export function resolveRequestBoardCreateInitialStep(
  entry: RequestBoardCreateEntryParam,
): RequestBoardCreateEntryStep {
  const value = Array.isArray(entry) ? entry[0] : entry;
  return value === 'newCustomer' ? 'newCustomer' : 'customer';
}

export function resolveRequestBoardCreateVisibleSteps(
  _entry: RequestBoardCreateEntryParam,
  source: RequestBoardCreateSourceParam,
): RequestBoardCreateStep[] {
  const sourceValue = Array.isArray(source) ? source[0] : source;
  if (sourceValue === 'customer-management') {
    return [];
  }
  return REQUEST_CREATE_STEPS;
}

export function canCreateRequestBoardRequest({
  role,
  readOnly,
  staffType,
  requestBoardRole,
  isRequestBoardDesigner,
}: RequestBoardPermissionInput) {
  return canUseRequestBoardAsFc({
    role,
    readOnly,
    staffType,
    requestBoardRole,
    isRequestBoardDesigner,
  });
}

export function resolveRequestBoardCreateBackTarget(
  step: RequestBoardCreateStep,
  composeEntryStep: RequestBoardCreateEntryStep,
): RequestBoardCreateBackTarget {
  if (step === 'customer') {
    return { type: 'back' };
  }
  if (step === 'newCustomer') {
    return { type: 'step', step: 'customer' };
  }
  if (step === 'compose') {
    return { type: 'step', step: composeEntryStep };
  }
  return { type: 'replace', path: '/request-board-requests' };
}

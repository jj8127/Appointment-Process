import { cancelExamApplicationWithPaymentProof } from '../exam-payment-proof-api';
import { EXAM_CANCELLATION_DEADLINE_MESSAGE } from '../exam-cancellation-policy';
import { supabase } from '../supabase';

jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;
const deadlineFailure = {
  ok: false,
  code: 'exam_cancellation_deadline_passed',
  message: EXAM_CANCELLATION_DEADLINE_MESSAGE,
};

describe('server-authoritative exam cancellation errors', () => {
  beforeEach(() => mockInvoke.mockReset());

  it.each(['http', 'envelope'])('keeps the deadline notice from a %s failure without demanding re-login', async (transport) => {
    mockInvoke.mockResolvedValue(transport === 'http'
      ? { data: null, error: { context: new Response(JSON.stringify(deadlineFailure), { status: 409 }) } }
      : { data: deadlineFailure, error: null });

    await expect(cancelExamApplicationWithPaymentProof('fictional-session', 'fictional-registration')).rejects.toMatchObject({
      name: 'ExamPaymentProofApiError',
      code: deadlineFailure.code,
      message: EXAM_CANCELLATION_DEADLINE_MESSAGE,
      needsRelogin: false,
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('sends the signed-session cancel request without accepting a caller clock or deadline', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, data: { cleanupWarning: false } }, error: null });

    await expect(cancelExamApplicationWithPaymentProof('  fictional-session  ', 'fictional-registration'))
      .resolves.toEqual({ cleanupWarning: false });
    expect(mockInvoke).toHaveBeenCalledWith('exam-payment-proof', {
      body: { action: 'cancel', registrationId: 'fictional-registration' },
      headers: { 'x-app-session-token': 'fictional-session' },
    });
  });
});

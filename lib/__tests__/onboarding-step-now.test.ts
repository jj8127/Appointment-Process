import {
  getAppointmentStepNow,
  getConsentStepNow,
  getDocsStepNow,
  getHanwhaStepNow,
} from '@/lib/onboarding-step-now';

describe('onboarding step now', () => {
  it('walks the consent step through waiting, my turn, rejection and approval', () => {
    expect(getConsentStepNow({ approved: false, tempId: '' }).tone).toBe('waiting');
    expect(getConsentStepNow({ approved: false, tempId: 'T1' }).tone).toBe('mine');
    expect(getConsentStepNow({ approved: false, tempId: 'T1', allowanceDate: '2026-10-01' }).tone).toBe('waiting');
    expect(
      getConsentStepNow({ approved: false, tempId: 'T1', allowanceDate: '2026-10-01', status: 'allowance-pending', rejectReason: ' 날짜 불일치 ' }),
    ).toMatchObject({ tone: 'rejected', reason: '날짜 불일치' });
    expect(getConsentStepNow({ approved: true, tempId: 'T1' }).tone).toBe('done');
  });

  it('puts rejected documents before missing ones and waits when nothing is requested', () => {
    expect(getDocsStepNow({ handedOff: false, docs: [] }).tone).toBe('waiting');
    expect(
      getDocsStepNow({ handedOff: false, docs: [{ status: 'rejected', hasFile: true }, { status: 'pending', hasFile: false }] }),
    ).toMatchObject({ tone: 'rejected', title: '반려된 서류 1건을 다시 올려주세요', detail: '제출 1/2 · 승인 0' });
    expect(getDocsStepNow({ handedOff: false, docs: [{ status: 'pending', hasFile: false }] })).toMatchObject({ tone: 'mine' });
    expect(getDocsStepNow({ handedOff: false, docs: [{ status: 'pending', hasFile: true }] }).tone).toBe('waiting');
    expect(getDocsStepNow({ handedOff: false, docs: [{ status: 'approved', hasFile: false }] }).tone).toBe('done');
  });

  it('keeps the commission step locked until documents pass and waits for the approval PDF', () => {
    const base = { blocked: false, approved: false, hasPdf: false, rejected: false, pending: false };
    expect(getHanwhaStepNow({ ...base, blocked: true }).tone).toBe('locked');
    expect(getHanwhaStepNow(base).tone).toBe('mine');
    expect(getHanwhaStepNow({ ...base, pending: true }).tone).toBe('waiting');
    expect(getHanwhaStepNow({ ...base, rejected: true, rejectReason: 'URL 미완료' })).toMatchObject({ tone: 'rejected', reason: 'URL 미완료' });
    expect(getHanwhaStepNow({ ...base, approved: true }).title).toContain('PDF');
    expect(getHanwhaStepNow({ ...base, approved: true, hasPdf: true }).tone).toBe('done');
  });

  it('names the insurance track that needs a report or a resubmission', () => {
    const life = { label: '생명' as const, scheduled: true, approved: false, pending: false };
    const nonlife = { label: '손해' as const, scheduled: true, approved: false, pending: false };
    expect(getAppointmentStepNow({ gateLocked: true, tracks: [life, nonlife] }).tone).toBe('locked');
    expect(getAppointmentStepNow({ gateLocked: false, tracks: [{ ...life, scheduled: false }, { ...nonlife, scheduled: false }] }).tone).toBe('waiting');
    expect(getAppointmentStepNow({ gateLocked: false, tracks: [{ ...life, approved: true }, nonlife] }).title).toBe('손해 위촉을 마치고 완료일을 보고해주세요');
    expect(getAppointmentStepNow({ gateLocked: false, tracks: [{ ...life, rejectReason: '날짜 오류' }, { ...nonlife, pending: true }] })).toMatchObject({ tone: 'rejected', reason: '날짜 오류' });
    expect(getAppointmentStepNow({ gateLocked: false, tracks: [{ ...life, pending: true }, { ...nonlife, approved: true }] }).tone).toBe('waiting');
    expect(getAppointmentStepNow({ gateLocked: false, tracks: [{ ...life, approved: true }, { ...nonlife, approved: true }] }).tone).toBe('done');
  });
});

import fs from 'node:fs';
import path from 'node:path';

import {
  parseAppointmentActionInput,
  parseDocStatusActionInput,
  parseExamRoundDeleteInput,
  parseExamRoundSaveInput,
  parseFcNotificationPhone,
} from '../../web/src/lib/privileged-action-input-policy';

const FC_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '22222222-2222-4222-8222-222222222222';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

const extractActionCalls = (source: string, actionName: string) =>
  Array.from(
    source.matchAll(new RegExp(`${actionName}\\([\\s\\S]*?\\n\\s*\\}?\\);`, 'g')),
    (match) => match[0],
  );

const extractExportedFunction = (source: string, functionName: string) => {
  const start = source.indexOf(`export async function ${functionName}`);
  const next = source.indexOf('export async function ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
};

describe('privileged server-action runtime input policy', () => {
  describe('exam schedule', () => {
    const validInput = {
      roundId: ROUND_ID,
      exam_date: '2026-07-31',
      registration_deadline: '2026-07-20',
      round_label: '  7월 생명보험 1차  ',
      exam_type: 'life',
      notes: '  안내 메모  ',
      locations: [' 서울 ', '부산'],
      actionLabel: '등록',
    };

    it('normalizes a valid save payload and discards the client action label', () => {
      const parsed = parseExamRoundSaveInput(validInput);

      expect(parsed).toEqual({
        ok: true,
        value: {
          roundId: ROUND_ID,
          exam_date: '2026-07-31',
          registration_deadline: '2026-07-20',
          round_label: '7월 생명보험 1차',
          exam_type: 'life',
          notes: '안내 메모',
          locations: ['서울', '부산'],
        },
      });
      if (parsed.ok) {
        expect(parsed.value).not.toHaveProperty('actionLabel');
      }
    });

    it.each([
      ['non-object', null],
      ['invalid round UUID', { ...validInput, roundId: 'round-1' }],
      ['impossible exam date', { ...validInput, exam_date: '2026-02-30' }],
      ['invalid deadline', { ...validInput, registration_deadline: '07/20/2026' }],
      ['deadline after exam date', { ...validInput, exam_date: '2026-07-20', registration_deadline: '2026-07-21' }],
      ['invalid exam type', { ...validInput, exam_type: 'all' }],
      ['oversized label', { ...validInput, round_label: '가'.repeat(121) }],
      ['oversized notes', { ...validInput, notes: '나'.repeat(2001) }],
      ['missing locations', { ...validInput, locations: [] }],
      ['too many locations', { ...validInput, locations: Array.from({ length: 51 }, (_, i) => `장소 ${i}`) }],
      ['oversized location', { ...validInput, locations: ['다'.repeat(121)] }],
    ])('rejects %s', (_name, input) => {
      expect(parseExamRoundSaveInput(input).ok).toBe(false);
    });

    it('requires a UUID for destructive deletion', () => {
      expect(parseExamRoundDeleteInput({ roundId: ROUND_ID })).toEqual({
        ok: true,
        value: { roundId: ROUND_ID },
      });
      expect(parseExamRoundDeleteInput({ roundId: 'round-1' }).ok).toBe(false);
      expect(parseExamRoundDeleteInput(null).ok).toBe(false);
    });
  });

  describe('appointment actions', () => {
    it.each([
      [{ fcId: FC_ID, phone: '01099999999', type: 'schedule', category: 'life', value: '  7월 예정  ' }, '7월 예정'],
      [{ fcId: FC_ID, type: 'confirm', category: 'nonlife', value: '2026-07-31' }, '2026-07-31'],
      [{ fcId: FC_ID, type: 'reject', category: 'life', value: null, reason: '  날짜 확인 필요  ' }, null],
    ])('accepts and normalizes a legitimate discriminated payload', (input, expectedValue) => {
      const parsed = parseAppointmentActionInput(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.value).toBe(expectedValue);
        expect(parsed.value).not.toHaveProperty('phone');
      }
    });

    it.each([
      ['invalid FC UUID', { fcId: 'fc-1', type: 'schedule', category: 'life', value: '7월' }],
      ['invalid action type', { fcId: FC_ID, type: 'delete', category: 'life', value: '7월' }],
      ['invalid category', { fcId: FC_ID, type: 'schedule', category: 'all', value: '7월' }],
      ['empty schedule value', { fcId: FC_ID, type: 'schedule', category: 'life', value: ' ' }],
      ['oversized schedule value', { fcId: FC_ID, type: 'schedule', category: 'life', value: '가'.repeat(201) }],
      ['invalid confirm date', { fcId: FC_ID, type: 'confirm', category: 'life', value: '2026-02-30' }],
      ['reject with non-null value', { fcId: FC_ID, type: 'reject', category: 'life', value: '2026-07-31', reason: '오류' }],
      ['reject without reason', { fcId: FC_ID, type: 'reject', category: 'life', value: null, reason: ' ' }],
      ['oversized reject reason', { fcId: FC_ID, type: 'reject', category: 'life', value: null, reason: '나'.repeat(1001) }],
    ])('rejects %s', (_name, input) => {
      expect(parseAppointmentActionInput(input).ok).toBe(false);
    });
  });

  describe('document status actions', () => {
    it.each(['approved', 'pending'])('accepts the %s status', (status) => {
      expect(parseDocStatusActionInput({ fcId: FC_ID, docType: '  생명보험 합격증  ', status }).ok).toBe(true);
    });

    it('requires a bounded reason for rejection', () => {
      const parsed = parseDocStatusActionInput({
        fcId: FC_ID,
        docType: '생명보험 합격증',
        status: 'rejected',
        reason: '  식별 불가  ',
        phone: '01099999999',
      });
      expect(parsed).toEqual({
        ok: true,
        value: {
          fcId: FC_ID,
          docType: '생명보험 합격증',
          status: 'rejected',
          reason: '식별 불가',
        },
      });
    });

    it.each([
      ['invalid FC UUID', { fcId: 'fc-1', docType: '합격증', status: 'approved' }],
      ['empty document type', { fcId: FC_ID, docType: ' ', status: 'approved' }],
      ['oversized document type', { fcId: FC_ID, docType: '다'.repeat(121), status: 'approved' }],
      ['invalid status', { fcId: FC_ID, docType: '합격증', status: 'deleted' }],
      ['missing rejection reason', { fcId: FC_ID, docType: '합격증', status: 'rejected' }],
      ['oversized reason', { fcId: FC_ID, docType: '합격증', status: 'rejected', reason: '라'.repeat(1001) }],
    ])('rejects %s', (_name, input) => {
      expect(parseDocStatusActionInput(input).ok).toBe(false);
    });
  });

  it('normalizes only an 11-digit database phone for notification delivery', () => {
    expect(parseFcNotificationPhone('010-1234-5678')).toEqual({ ok: true, value: '01012345678' });
    expect(parseFcNotificationPhone('0101234567').ok).toBe(false);
    expect(parseFcNotificationPhone('010123456789').ok).toBe(false);
    expect(parseFcNotificationPhone('victim:01012345678').ok).toBe(false);
    expect(parseFcNotificationPhone(null).ok).toBe(false);
  });
});

describe('privileged server-action source-to-sink integration contract', () => {
  it('validates exam mutations before service-role access and derives the action label on the server', () => {
    const source = readRepoFile('web/src/app/dashboard/exam/schedule/actions.ts');
    const saveStart = source.indexOf('export async function saveExamRoundAction');
    const fetchStart = source.indexOf('export async function fetchExamRoundsAction');
    const deleteStart = source.indexOf('export async function deleteExamRoundAction');
    const saveSource = source.slice(saveStart, fetchStart);
    const deleteSource = source.slice(deleteStart);

    expect(saveSource.indexOf('parseExamRoundSaveInput(payload)')).toBeGreaterThanOrEqual(0);
    expect(saveSource.indexOf('await getVerifiedAdminSession()')).toBeLessThan(saveSource.indexOf('parseExamRoundSaveInput(payload)'));
    expect(saveSource.indexOf('parseExamRoundSaveInput(payload)')).toBeLessThan(saveSource.indexOf('adminSupabase'));
    expect(saveSource).toMatch(/if \(!sessionCheck\.ok\) \{[\s\S]{0,300}return \{ success: false, error: sessionCheck\.error \};/);
    expect(saveSource).not.toContain('actionLabel');
    expect(saveSource).toContain("const actionText = roundId ? '수정' : '등록'");
    expect(deleteSource.indexOf('parseExamRoundDeleteInput(payload)')).toBeGreaterThanOrEqual(0);
    expect(deleteSource.indexOf('await getVerifiedAdminSession()')).toBeLessThan(deleteSource.indexOf('parseExamRoundDeleteInput(payload)'));
    expect(deleteSource.indexOf('parseExamRoundDeleteInput(payload)')).toBeLessThan(deleteSource.indexOf('adminSupabase'));
    expect(deleteSource).toMatch(/if \(!sessionCheck\.ok\) \{[\s\S]{0,300}return \{ success: false, error: sessionCheck\.error \};/);
  });

  it('derives appointment and document notification targets from fc_profiles instead of client input', () => {
    const appointment = readRepoFile('web/src/app/dashboard/appointment/actions.ts');
    const docs = readRepoFile('web/src/app/dashboard/docs/actions.ts');
    const appointmentPage = readRepoFile('web/src/app/dashboard/appointment/page.tsx');
    const dashboardPage = readRepoFile('web/src/app/dashboard/page.tsx');
    const appointmentAction = extractExportedFunction(appointment, 'updateAppointmentAction');
    const docsAction = extractExportedFunction(docs, 'updateDocStatusAction');

    expect(appointment).toContain('parseAppointmentActionInput(payload)');
    expect(appointmentAction.indexOf('await getVerifiedAdminSession()')).toBeLessThan(appointmentAction.indexOf('parseAppointmentActionInput(payload)'));
    expect(appointmentAction.indexOf('parseAppointmentActionInput(payload)')).toBeLessThan(appointmentAction.indexOf('adminSupabase'));
    expect(appointmentAction).toMatch(/if \(!sessionCheck\.ok\) \{[\s\S]{0,300}return \{ success: false, error: sessionCheck\.error \};/);
    expect(appointment).not.toContain('phone: string;');
    expect(appointment).not.toContain('const { fcId, phone,');
    expect(appointment).toContain('parseFcNotificationPhone(currentProfile.phone)');
    expect(appointment).toContain('resident_id: notificationPhone');
    expect(appointment).toContain('sendPushNotification(notificationPhone');

    expect(docs).toContain('parseDocStatusActionInput(payload)');
    expect(docsAction.indexOf('await getVerifiedAdminSession()')).toBeLessThan(docsAction.indexOf('parseDocStatusActionInput(payload)'));
    expect(docsAction.indexOf('parseDocStatusActionInput(payload)')).toBeLessThan(docsAction.indexOf('adminSupabase'));
    expect(docsAction).toMatch(/if \(!sessionCheck\.ok\) \{[\s\S]{0,300}return \{ success: false, error: sessionCheck\.error \};/);
    expect(docs).not.toContain('phone: string;');
    expect(docs).not.toContain('const { fcId, phone,');
    expect(docs).toContain(".from('fc_profiles')");
    expect(docs).toContain('parseFcNotificationPhone(profile.phone)');
    expect(docs).toContain('resident_id: notificationPhone');
    expect(docs).toContain('sendPushNotification(notificationPhone');

    const appointmentCalls = [
      ...extractActionCalls(appointmentPage, 'updateAppointmentAction'),
      ...extractActionCalls(dashboardPage, 'updateAppointmentAction'),
    ];
    const docCalls = extractActionCalls(dashboardPage, 'updateDocStatusAction');
    expect(appointmentCalls.length).toBeGreaterThan(0);
    expect(docCalls.length).toBeGreaterThan(0);
    for (const call of [...appointmentCalls, ...docCalls]) {
      expect(call).not.toMatch(/\bphone\s*:/);
    }
  });
});

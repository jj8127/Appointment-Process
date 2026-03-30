import {
  ADMIN_STEP_LABELS,
  STEP_LABELS,
  calcStep,
  getStatusLabel,
  getSummaryStatus,
} from '../../web/src/lib/shared';
import { getAllowanceDisplayState, getFcHomeNextAction } from '../fc-workflow';
import type { FcProfile } from '../../web/src/types/fc';

const approvedDocs: FcProfile['fc_documents'] = [
  {
    doc_type: '생명보험 합격증',
    storage_path: 'fc-documents/sample.pdf',
    status: 'approved',
  },
];

const profile = (overrides: Partial<FcProfile> = {}): FcProfile => ({
  id: 'fc-1',
  name: '테스트',
  affiliation: '1팀',
  phone: '01012345678',
  status: 'draft',
  created_at: '2026-02-26T00:00:00.000Z',
  resident_id_masked: null,
  identity_completed: false,
  address: null,
  allowance_date: null,
  allowance_prescreen_requested_at: null,
  allowance_reject_reason: null,
  life_commission_completed: false,
  nonlife_commission_completed: false,
  fc_documents: [],
  ...overrides,
});

describe('workflow step regression', () => {
  test('legacy partial-commission signup does not jump to step 4', () => {
    const row = profile({
      status: 'appointment-completed',
      life_commission_completed: true,
      nonlife_commission_completed: false,
      resident_id_masked: null,
      address: null,
      identity_completed: false,
      allowance_date: null,
      fc_documents: [],
    });
    expect(calcStep(row)).toBe(1);
  });

  test('identity completed without allowance stays at step 1', () => {
    const row = profile({
      status: 'draft',
      life_commission_completed: true,
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: null,
    });
    expect(calcStep(row)).toBe(1);
  });

  test('allowance passed without approved docs stays at step 2', () => {
    const row = profile({
      status: 'allowance-consented',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: [],
    });
    expect(calcStep(row)).toBe(2);
  });

  test('docs approved without hanwha approval stays at step 3', () => {
    const row = profile({
      status: 'docs-approved',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: approvedDocs,
    });
    expect(calcStep(row)).toBe(3);
  });

  test('stale hanwha pdf metadata alone does not unlock url stage', () => {
    const row = profile({
      status: 'docs-approved',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      hanwha_commission_pdf_path: 'fc-documents/old-hanwha.pdf',
      hanwha_commission_pdf_name: 'old-hanwha.pdf',
      fc_documents: approvedDocs,
    });
    expect(calcStep(row)).toBe(3);
  });

  test.each([
    {
      name: 'missing',
      row: profile({
        status: 'allowance-pending',
        temp_id: 'TMP-001',
        resident_id_masked: '900101-*******',
        identity_completed: true,
        address: '서울시 중구',
        allowance_date: null,
      }),
      expected: { key: 'missing', label: 'FC 수당 동의일 미입력', color: 'gray' },
      summary: { label: 'FC 수당 동의일 미입력', color: 'gray' },
    },
    {
      name: 'entered',
      row: profile({
        status: 'allowance-pending',
        temp_id: 'TMP-001',
        resident_id_masked: '900101-*******',
        identity_completed: true,
        address: '서울시 중구',
        allowance_date: '2026-02-20',
      }),
      expected: { key: 'entered', label: 'FC 수당 동의 입력 완료', color: 'orange' },
      summary: { label: 'FC 수당 동의 입력 완료', color: 'orange' },
    },
    {
      name: 'prescreen',
      row: profile({
        status: 'allowance-pending',
        temp_id: 'TMP-001',
        resident_id_masked: '900101-*******',
        identity_completed: true,
        address: '서울시 중구',
        allowance_date: '2026-02-20',
        allowance_prescreen_requested_at: '2026-02-21T09:00:00+09:00',
      }),
      expected: { key: 'prescreen', label: '사전 심사 요청 완료', color: 'blue' },
      summary: { label: '사전 심사 요청 완료', color: 'blue' },
    },
    {
      name: 'approved',
      row: profile({
        status: 'allowance-consented',
        temp_id: 'TMP-001',
        resident_id_masked: '900101-*******',
        identity_completed: true,
        address: '서울시 중구',
        allowance_date: '2026-02-20',
      }),
      expected: { key: 'approved', label: '승인 완료', color: 'green' },
    },
    {
      name: 'rejected',
      row: profile({
        status: 'allowance-pending',
        temp_id: 'TMP-001',
        resident_id_masked: '900101-*******',
        identity_completed: true,
        address: '서울시 중구',
        allowance_date: null,
        allowance_reject_reason: '서명 누락',
      }),
      expected: { key: 'rejected', label: '미승인', color: 'red' },
      summary: { label: '미승인', color: 'red' },
    },
  ])('allowance derived display state: $name', ({ row, expected, summary }) => {
    expect(getAllowanceDisplayState(row as any)).toEqual(expected);
    if (summary) {
      expect(getSummaryStatus(row)).toEqual(summary);
    }
    expect(getStatusLabel(row)).toBe(expected.label);
  });

  test('docs approved with stale commission evidence stays at step 3', () => {
    const row = profile({
      status: 'docs-approved',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      life_commission_completed: true,
      nonlife_commission_completed: false,
      fc_documents: approvedDocs,
    });
    expect(calcStep(row)).toBe(3);
  });

  test('workflow step labels pin step 3 and 4 naming', () => {
    expect(STEP_LABELS.step3).toBe('3단계 한화 위촉 URL');
    expect(STEP_LABELS.step4).toBe('4단계 생명/손해 위촉');
    expect(ADMIN_STEP_LABELS.step3).toBe('3단계 한화 위촉 URL');
    expect(ADMIN_STEP_LABELS.step4).toBe('4단계 생명/손해 위촉');
  });

  test('legacy appointment stage status still stays at step 4 without hanwha pdf', () => {
    const row = profile({
      status: 'appointment-completed',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      life_commission_completed: true,
      fc_documents: approvedDocs,
    });
    expect(calcStep(row)).toBe(4);
  });

  test('one flag + opposite appointment date is treated as final completion', () => {
    const row = profile({
      status: 'appointment-completed',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      life_commission_completed: true,
      appointment_date_nonlife: '2026-02-25',
      fc_documents: approvedDocs,
    });
    expect(calcStep(row)).toBe(5);
  });

  test('signup with both commissions completed shows final summary even without docs', () => {
    const row = profile({
      status: 'final-link-sent',
      life_commission_completed: true,
      nonlife_commission_completed: true,
      fc_documents: [],
    });

    expect(calcStep(row)).toBe(5);
    expect(getSummaryStatus(row).label).toBe('가입 시 위촉 완료');
  });

  test('fc home still opens docs page until admin requests documents', () => {
    const row = profile({
      status: 'allowance-consented',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: [],
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 2,
      key: 'docs',
      route: '/docs-upload',
      subtitle: '총무가 필요한 서류를 검토 중입니다. 기다려주세요.',
      disabled: false,
    });
  });

  test('fc home keeps hanwha CTA active after hanwha submission while waiting for approval', () => {
    const row = profile({
      status: 'hanwha-commission-review',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      hanwha_commission_date_sub: '2026-02-26',
      fc_documents: approvedDocs,
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 3,
      key: 'hanwha',
      route: '/hanwha-commission',
      disabled: false,
    });
  });

  test('fc home still opens hanwha page until approved pdf is registered', () => {
    const row = profile({
      status: 'hanwha-commission-approved',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      hanwha_commission_date: '2026-02-26',
      fc_documents: approvedDocs,
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 3,
      key: 'hanwha',
      route: '/hanwha-commission',
      disabled: false,
    });
  });

  test('fc home shows entered allowance next action while prescreen is not requested yet', () => {
    const row = profile({
      status: 'allowance-pending',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 1,
      key: 'consent',
      route: '/consent',
      subtitle: '총무가 사전 심사를 준비 중입니다.',
      disabled: false,
    });
  });

  test('fc home shows prescreen next action after admin requests allowance prescreen', () => {
    const row = profile({
      status: 'allowance-pending',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      allowance_prescreen_requested_at: '2026-02-21T09:00:00+09:00',
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 1,
      key: 'consent',
      route: '/consent',
      subtitle: '사전 심사 결과를 기다리는 중입니다.',
      disabled: false,
    });
  });

  test('fc home points back to docs upload when a requested document is rejected', () => {
    const row = profile({
      status: 'docs-rejected',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: [
        {
          doc_type: '생명보험 합격증',
          storage_path: 'fc-documents/sample.pdf',
          status: 'rejected',
        },
      ],
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 2,
      key: 'docs',
      route: '/docs-upload',
      disabled: false,
    });
  });

  test('fc home asks for all documents again when an approved document is deleted', () => {
    const row = profile({
      status: 'docs-pending',
      temp_id: 'TMP-001',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: [
        {
          doc_type: '생명보험 합격증',
          storage_path: 'deleted',
          status: 'pending',
        },
      ],
    });

    expect(getFcHomeNextAction(row as any)).toMatchObject({
      step: 2,
      key: 'docs',
      route: '/docs-upload',
      subtitle: '모든 문서를 제출하세요.',
      disabled: false,
    });
  });
});

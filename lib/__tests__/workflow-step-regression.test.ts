import { calcStep } from '../../web/src/lib/shared';
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

  test('identity completed without allowance stays at step 2', () => {
    const row = profile({
      status: 'draft',
      life_commission_completed: true,
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: null,
    });
    expect(calcStep(row)).toBe(2);
  });

  test('allowance passed without approved docs stays at step 3', () => {
    const row = profile({
      status: 'allowance-consented',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      fc_documents: [],
    });
    expect(calcStep(row)).toBe(3);
  });

  test('docs approved with one commission complete moves to step 4', () => {
    const row = profile({
      status: 'docs-approved',
      resident_id_masked: '900101-*******',
      identity_completed: true,
      address: '서울시 중구',
      allowance_date: '2026-02-20',
      life_commission_completed: true,
      nonlife_commission_completed: false,
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
});

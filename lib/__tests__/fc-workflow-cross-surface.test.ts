import * as mobileWorkflow from '../fc-workflow';
import * as webWorkflow from '../../web/src/lib/fc-workflow';
import { getStepDisplay, getSummaryStatus } from '../../web/src/lib/shared';
import type { FcProfile } from '../../web/src/types/fc';
import fs from 'fs';
import path from 'path';

const profile = (overrides: Partial<FcProfile> = {}): FcProfile => ({
  id: 'fc-cross-surface',
  name: 'Cross Surface FC',
  affiliation: '1',
  phone: '01012345678',
  status: 'draft',
  created_at: '2026-07-04T00:00:00.000Z',
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

const approvedDocs: FcProfile['fc_documents'] = [
  {
    doc_type: 'life-license',
    storage_path: 'fc-documents/license.pdf',
    status: 'approved',
  },
];

describe('fc workflow cross-surface contract', () => {
  test('web workflow module delegates business rules to the shared core', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../web/src/lib/fc-workflow.ts'),
      'utf8',
    );

    expect(source).toContain("from '../../../lib/fc-workflow-core'");
    expect(source).not.toMatch(/export const (getAllowanceDisplayState|calcWorkflowStep|hasAllowancePassed)/);
    expect(source).not.toMatch(/const ALLOWANCE_PASSED_STATUSES/);
  });

  test.each([
    {
      name: 'pre-screen requested before allowance date',
      row: profile({
        status: 'allowance-pending',
        temp_id: 'TMP-001',
        identity_completed: true,
        resident_id_masked: '900101-*******',
        address: 'Seoul',
        allowance_date: null,
        allowance_prescreen_requested_at: '2026-07-04T10:00:00+09:00',
      }),
    },
    {
      name: 'allowance passed but documents not approved',
      row: profile({
        status: 'allowance-consented',
        temp_id: 'TMP-001',
        identity_completed: true,
        resident_id_masked: '900101-*******',
        address: 'Seoul',
        allowance_date: '2026-07-04',
      }),
    },
    {
      name: 'documents approved but hanwha pdf not registered',
      row: profile({
        status: 'docs-approved',
        temp_id: 'TMP-001',
        identity_completed: true,
        resident_id_masked: '900101-*******',
        address: 'Seoul',
        allowance_date: '2026-07-04',
        fc_documents: approvedDocs,
      }),
    },
    {
      name: 'one commission submitted for admin review',
      row: profile({
        status: 'appointment-completed',
        temp_id: 'TMP-001',
        identity_completed: true,
        resident_id_masked: '900101-*******',
        address: 'Seoul',
        allowance_date: '2026-07-04',
        hanwha_commission_date: '2026-07-04',
        hanwha_commission_pdf_path: 'fc-documents/hanwha.pdf',
        hanwha_commission_pdf_name: 'hanwha.pdf',
        life_commission_completed: true,
        fc_documents: approvedDocs,
      }),
    },
  ])('mobile and web workflow helpers stay in parity: $name', ({ row }) => {
    expect(mobileWorkflow.calcWorkflowStep(row as any)).toBe(webWorkflow.calcWorkflowStep(row as any));
    expect(mobileWorkflow.calcAdminWorkflowStep(row as any)).toBe(webWorkflow.calcAdminWorkflowStep(row as any));
    expect(mobileWorkflow.getAllowanceDisplayState(row as any)).toEqual(
      webWorkflow.getAllowanceDisplayState(row as any),
    );
    expect(getStepDisplay(row).step).toBe(webWorkflow.calcWorkflowStep(row as any));
    expect(getSummaryStatus(row).color).toBeTruthy();
  });

  test('appointment completion status is derived from the same commission completion core', () => {
    const partial = profile({ life_commission_completed: true, nonlife_commission_completed: false });
    const complete = profile({ life_commission_completed: true, nonlife_commission_completed: true });

    expect(webWorkflow.resolveAppointmentCompletionStatus(partial as any)).toBe('appointment-completed');
    expect(webWorkflow.resolveAppointmentCompletionStatus(complete as any)).toBe('final-link-sent');
    expect(mobileWorkflow.getCommissionCompletionState(complete as any)).toEqual(
      webWorkflow.getCommissionCompletionState(complete as any),
    );
  });
});

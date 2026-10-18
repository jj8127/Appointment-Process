import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPhoneCandidates } from './phone-candidates.ts';
import {
  applyExamApplicantApplicationTypes,
  buildExamApplicantBaseRows,
  buildExamApplicantPhoneCandidates,
  buildExamApplicantProfileMatchPlan,
  isExamApplicantProfileRow,
  isExamRegistrationRow,
  enrichExamApplicantsWithResidentNumbers,
} from './exam-applicant-resident-number-enrichment.ts';

test('exam applicant source guards reject malformed successful query rows', () => {
  const registration = {
    id: 'registration-1', status: 'applied', created_at: '2026-01-01T00:00:00Z',
    resident_id: '01000000000', is_confirmed: false,
    exam_locations: { location_name: null },
    exam_rounds: { round_label: '1회', exam_date: null, exam_type: 'life' },
  };
  assert.equal(isExamRegistrationRow(registration), true);
  assert.equal(isExamRegistrationRow({ ...registration, is_confirmed: 'false' }), false);
  assert.equal(isExamRegistrationRow({ ...registration, exam_rounds: [] }), false);

  const profile = { id: 'fc-1', phone: '01000000000', name: null, affiliation: null, address: null };
  assert.equal(isExamApplicantProfileRow(profile), true);
  assert.equal(isExamApplicantProfileRow({ ...profile, phone: null }), false);
  assert.equal(isExamApplicantProfileRow({ ...profile, address: 7 }), false);
});

test('exam applicant base rows keep current response defaults', () => {
  const baseRows = buildExamApplicantBaseRows([
    {
      id: 'reg-1',
      status: 'applied',
      created_at: '2026-05-01T00:00:00.000Z',
      round_id: null,
      resident_id: '01012345678',
      is_confirmed: false,
      is_third_exam: null,
      fee_paid_date: null,
      exam_locations: null,
      exam_rounds: null,
    },
    {
      id: 'reg-2',
      status: 'confirmed',
      created_at: '2026-05-02T00:00:00.000Z',
      round_id: 'round-2',
      resident_id: '010-9999-0000',
      is_confirmed: true,
      is_third_exam: true,
      fee_paid_date: '2026-05-03',
      exam_locations: { location_name: '서울' },
      exam_rounds: {
        round_label: '1차',
        exam_date: '2026-06-01',
        exam_type: 'written',
      },
    },
  ]);

  assert.deepStrictEqual(baseRows, [
    {
      id: 'reg-1',
      status: 'applied',
      created_at: '2026-05-01T00:00:00.000Z',
      round_id: null,
      resident_id: '01012345678',
      is_confirmed: false,
      includes_primary_exam: true,
      is_third_exam: false,
      application_type: '신규신청',
      location_name: '미정',
      round_label: '-',
      exam_date: null,
      exam_type: null,
      fee_paid_date: null,
      payment_proof_attached: false,
      rejection_reason: null,
      rejected_at: null,
    },
    {
      id: 'reg-2',
      status: 'confirmed',
      created_at: '2026-05-02T00:00:00.000Z',
      round_id: 'round-2',
      resident_id: '010-9999-0000',
      is_confirmed: true,
      includes_primary_exam: true,
      is_third_exam: true,
      application_type: '신규신청',
      location_name: '서울',
      round_label: '1차',
      exam_date: '2026-06-01',
      exam_type: 'written',
      fee_paid_date: '2026-05-03',
      payment_proof_attached: false,
      rejection_reason: null,
      rejected_at: null,
    },
  ]);
});

test('exam applicant application type marks later same-subject registration as re-application', () => {
  const rows = buildExamApplicantBaseRows([
    {
      id: 'reg-new-life',
      status: 'applied',
      created_at: '2026-06-01T00:00:00.000Z',
      resident_id: '01012345678',
      is_confirmed: false,
      is_third_exam: false,
      fee_paid_date: null,
      exam_locations: { location_name: '서울' },
      exam_rounds: { round_label: '공통 7차', exam_date: '2026-06-17', exam_type: 'life' },
    },
    {
      id: 'reg-retry-life',
      status: 'applied',
      created_at: '2026-06-02T00:00:00.000Z',
      resident_id: '010-1234-5678',
      is_confirmed: false,
      is_third_exam: false,
      fee_paid_date: null,
      exam_locations: { location_name: '부산' },
      exam_rounds: { round_label: '공통 8차', exam_date: '2026-06-18', exam_type: 'life' },
    },
    {
      id: 'reg-new-life-third',
      status: 'applied',
      created_at: '2026-06-03T00:00:00.000Z',
      resident_id: '01012345678',
      is_confirmed: false,
      is_third_exam: true,
      fee_paid_date: null,
      exam_locations: { location_name: '서울' },
      exam_rounds: { round_label: '공통 9차', exam_date: '2026-06-19', exam_type: 'life' },
    },
    {
      id: 'reg-new-nonlife',
      status: 'applied',
      created_at: '2026-06-04T00:00:00.000Z',
      resident_id: '01012345678',
      is_confirmed: false,
      is_third_exam: false,
      fee_paid_date: null,
      exam_locations: { location_name: '서울' },
      exam_rounds: { round_label: '손해 1차', exam_date: '2026-06-20', exam_type: 'nonlife' },
    },
  ]);

  const withTypes = applyExamApplicantApplicationTypes(rows);

  assert.deepStrictEqual(
    withTypes.map((row) => [row.id, row.application_type]),
    [
      ['reg-new-life', '신규신청'],
      ['reg-retry-life', '재신청'],
      ['reg-new-life-third', '신규신청'],
      ['reg-new-nonlife', '신규신청'],
    ],
  );
});

test('exam applicant profile lookup uses current phone candidate aliases and de-dupes reads', () => {
  const applicants = buildExamApplicantBaseRows([
    {
      id: 'reg-1',
      status: 'applied',
      created_at: '2026-05-01T00:00:00.000Z',
      resident_id: '01012345678',
      is_confirmed: false,
      exam_locations: { location_name: '' },
      exam_rounds: { round_label: '', exam_date: null, exam_type: null },
    },
    {
      id: 'reg-2',
      status: 'applied',
      created_at: '2026-05-02T00:00:00.000Z',
      resident_id: '010-2222-3333',
      is_confirmed: false,
      is_third_exam: false,
      fee_paid_date: null,
      exam_locations: null,
      exam_rounds: null,
    },
    {
      id: 'reg-3',
      status: 'applied',
      created_at: '2026-05-03T00:00:00.000Z',
      resident_id: '01044445555',
      is_confirmed: false,
      is_third_exam: false,
      fee_paid_date: null,
      exam_locations: null,
      exam_rounds: null,
    },
  ]);

  assert.deepStrictEqual(
    buildExamApplicantPhoneCandidates(applicants, buildPhoneCandidates),
    [
      '01012345678',
      '010-1234-5678',
      '010-2222-3333',
      '01022223333',
      '01044445555',
      '010-4444-5555',
    ],
  );

  const matchPlan = buildExamApplicantProfileMatchPlan([
    {
      id: 'fc-1',
      phone: '010-1234-5678',
      name: '김하나',
      affiliation: null,
      address: '서울',
    },
    {
      id: 'fc-1',
      phone: '010-1234-5678',
      name: '김하나',
      affiliation: null,
      address: '서울',
    },
    {
      id: 'fc-2',
      phone: '01022223333',
      name: null,
      affiliation: '본부',
      address: null,
    },
  ], buildPhoneCandidates);

  assert.deepStrictEqual(matchPlan.fcIds, ['fc-1', 'fc-2']);

  assert.deepStrictEqual(
    enrichExamApplicantsWithResidentNumbers({
      applicants,
      profileByCandidate: matchPlan.profileByCandidate,
      residentNumbersByFcId: {
        'fc-1': '900101-1234567',
        'fc-2': null,
      },
      buildPhoneCandidates,
    }),
    [
      {
        ...applicants[0],
        name: '김하나',
        phone: '010-1234-5678',
        affiliation: '-',
        address: '서울',
        resident_id: '900101-1234567',
      },
      {
        ...applicants[1],
        name: '이름없음',
        phone: '01022223333',
        affiliation: '본부',
        address: '-',
        resident_id: '주민번호 조회 실패',
      },
      {
        ...applicants[2],
        name: '이름없음',
        phone: '01044445555',
        affiliation: '-',
        address: '-',
        resident_id: '주민번호 조회 실패',
      },
    ],
  );
});

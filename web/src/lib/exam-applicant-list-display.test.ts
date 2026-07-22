import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('exam applicant list display columns follow the confirmed admin workbook order', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');
  assert.deepStrictEqual(
    mod.EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => column.title),
    [
      '소속',
      '응시자 이름',
      '주민등록번호(전체)',
      '주소',
      '전화번호',
      '시험 신청일',
      '시험응시 과목',
      '시험 신청 구분',
      '생명보험 응시일자',
      '생명보험 고사장',
      '손해보험 응시일자',
      '손해보험 고사장',
      '제3보험 포함 여부',
      '응시료 입금 날짜',
    ],
  );

  assert.equal(
    mod.EXAM_APPLICANT_EXPORT_COLUMNS.map((column) => column.key).at(5),
    'application_created_at',
  );
});

test('시험 신청일 column uses date-only formatter', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const createdAtColumn = mod.EXAM_APPLICANT_EXPORT_COLUMNS.find(
    (column) => column.key === 'application_created_at',
  );

  assert.ok(createdAtColumn, 'application_created_at column should exist');
  assert.equal(createdAtColumn.title, '시험 신청일');

  const value = mod.getExamApplicantCellValue(
    {
      round_id: 'life-1',
      affiliation: '영업본부',
      name: '홍길동',
      resident_id: '900101-1234567',
      address: '서울시',
      phone: '010-1111-2222',
      created_at: '2026-06-01T09:00:00.000Z',
      status: 'applied',
      is_confirmed: true,
      is_third_exam: false,
    } as unknown as Parameters<typeof mod.getExamApplicantCellValue>[0],
    'application_created_at',
  );

  assert.equal(value, '2026-06-01');

  const sources = [
    readFileSync('web/src/app/dashboard/exam/applicants/page.tsx', 'utf8'),
    readFileSync('web/src/app/admin/exams/[id]/page.tsx', 'utf8'),
  ];

  for (const source of sources) {
    assert.match(
      source,
      /column\.key === 'application_created_at'[\s\S]{0,160}<Table\.Td key=\{column\.key\} ta="center">/,
    );
    assert.match(
      source,
      /column\.key === 'application_created_at'[\s\S]{0,240}<Text size="sm" c=\{value === '-' \? 'dimmed' : undefined\} ta="center">/,
    );
  }
});

test('exam applicant fee paid column remains last', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  assert.equal(
    mod.EXAM_APPLICANT_EXPORT_COLUMNS.at(-1)?.key,
    'fee_paid_date',
  );
});

test('fee paid date column uses concise label and centered table text', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const feePaidDateColumn = mod.EXAM_APPLICANT_EXPORT_COLUMNS.find(
    (column) => column.key === 'fee_paid_date',
  );
  assert.ok(feePaidDateColumn, 'fee_paid_date column should exist');
  assert.equal(feePaidDateColumn.title, '응시료 입금 날짜');

  const sources = [
    readFileSync('web/src/app/dashboard/exam/applicants/page.tsx', 'utf8'),
    readFileSync('web/src/app/admin/exams/[id]/page.tsx', 'utf8'),
  ];

  for (const source of sources) {
    assert.match(
      source,
      /column\.key === 'fee_paid_date'[\s\S]{0,160}<Table\.Td key=\{column\.key\} ta="center">/,
    );
    assert.match(
      source,
      /column\.key === 'fee_paid_date'[\s\S]{0,240}<Text size="sm" c=\{value === '-' \? 'dimmed' : undefined\} ta="center">/,
    );
  }
});

test('exam applicant display values split life and nonlife schedule fields', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const lifeThirdApplicant = {
    id: 'reg-1',
    status: 'applied',
    created_at: '2026-06-01T00:00:00.000Z',
    resident_id: '900101-1234567',
    name: '박테스트',
    phone: '01012345678',
    affiliation: '2본부 테스트',
    address: '서울시 중구',
    location_name: '서울',
    round_label: '공통 7차',
    exam_date: '2026-06-17',
    exam_type: 'life',
    fee_paid_date: '2026-06-10',
    is_confirmed: true,
    is_third_exam: true,
    application_type: '재신청',
  };

  const nonlifeApplicant = {
    ...lifeThirdApplicant,
    id: 'reg-2',
    round_label: '손해 2차',
    exam_date: '2026-06-18',
    exam_type: 'nonlife',
    location_name: '부산',
    is_third_exam: false,
    fee_paid_date: null,
    application_type: '신규신청',
  };

  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'subject_display'), '생명보험+제3보험');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'life_exam_date'), '공통 7차: 06/17 (수)');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'life_location'), '서울');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'nonlife_exam_date'), '-');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'third_exam'), '포함');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'fee_paid_date'), '2026-06-10');
  assert.equal(mod.getExamApplicantCellValue(lifeThirdApplicant, 'application_type'), '재신청');

  assert.equal(mod.getExamApplicantCellValue(nonlifeApplicant, 'life_exam_date'), '-');
  assert.equal(mod.getExamApplicantCellValue(nonlifeApplicant, 'nonlife_exam_date'), '손해 2차: 06/18 (목)');
  assert.equal(mod.getExamApplicantCellValue(nonlifeApplicant, 'nonlife_location'), '부산');
  assert.equal(mod.getExamApplicantCellValue(nonlifeApplicant, 'third_exam'), '-');
  assert.equal(mod.getExamApplicantCellValue(nonlifeApplicant, 'fee_paid_date'), '-');
});

test('top exam applicant filters build de-duped subject options from current rows', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const rows = [
    {
      round_id: 'life-1',
      round_label: '공통 7차',
      exam_date: '2026-06-17',
      exam_type: 'life',
      is_third_exam: false,
    },
    {
      round_id: 'life-1',
      round_label: '공통 7차',
      exam_date: '2026-06-17',
      exam_type: 'life',
      is_third_exam: false,
    },
    {
      round_id: 'life-third-1',
      round_label: '공통 8차',
      exam_date: '2026-06-18',
      exam_type: 'life',
      is_third_exam: true,
    },
    {
      round_id: 'nonlife-1',
      round_label: '손해 1차',
      exam_date: '2026-06-20',
      exam_type: 'nonlife',
      is_third_exam: false,
    },
  ];

  assert.deepStrictEqual(mod.buildExamApplicantSubjectFilterOptions(rows), [
    { value: mod.EXAM_APPLICANT_ALL_FILTER_VALUE, label: '전체' },
    { value: 'life:base', label: '생명보험' },
    { value: 'life:third', label: '생명보험+제3보험' },
    { value: 'nonlife:base', label: '손해보험' },
  ]);
});

test('exam applicant quick affiliations pin requested headquarters and match legacy composite labels', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');
  assert.deepStrictEqual(
    mod.buildExamApplicantQuickAffiliationOptions([
      { affiliation: '8본부 정승철' },
      { affiliation: '1본부 서선미' },
      { affiliation: '6본부 김정수(박선희)' },
      { affiliation: '9본부 이현욱(김주용)' },
    ]),
    [
      '전체',
      '1본부 서선미',
      '2본부 박성훈',
      '6본부 김정수',
      '8본부 정승철',
      '9본부 김주용',
      '10본부 한태균',
    ],
  );
  assert.equal(mod.matchesExamApplicantQuickAffiliation('6본부 김정수(박선희)', '6본부 김정수'), true);
  assert.equal(mod.matchesExamApplicantQuickAffiliation('9본부 이현욱(김주용)', '9본부 김주용'), true);
  assert.equal(mod.matchesExamApplicantQuickAffiliation('1본부 서선미', '2본부 박성훈'), false);
});

test('top exam applicant round filters narrow by selected subject and format labels', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const rows = [
    {
      round_id: 'life-1',
      round_label: '공통 7차',
      exam_date: '2026-06-17',
      exam_type: 'life',
      is_third_exam: false,
    },
    {
      round_id: 'life-third-1',
      round_label: '공통 8차',
      exam_date: '2026-06-18T00:00:00+00:00',
      exam_type: 'life',
      is_third_exam: true,
    },
    {
      round_id: 'nonlife-1',
      round_label: '손해 1차',
      exam_date: '2026-06-20',
      exam_type: 'nonlife',
      is_third_exam: false,
    },
  ];

  assert.equal(
    mod.formatExamApplicantRoundFilterLabel(rows[1]),
    '2026-06-18 · 공통 8차 · 생명보험+제3보험',
  );

  assert.deepStrictEqual(mod.buildExamApplicantRoundFilterOptions(rows, 'life:base'), [
    { value: mod.EXAM_APPLICANT_ALL_FILTER_VALUE, label: '전체' },
    { value: 'life-1', label: '2026-06-17 · 공통 7차 · 생명보험' },
  ]);

  assert.deepStrictEqual(mod.buildExamApplicantRoundFilterOptions(rows, 'nonlife:base'), [
    { value: mod.EXAM_APPLICANT_ALL_FILTER_VALUE, label: '전체' },
    { value: 'nonlife-1', label: '2026-06-20 · 손해 1차 · 손해보험' },
  ]);
});

test('top exam applicant round filter validity follows selected subject', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const rows = [
    {
      round_id: 'life-1',
      round_label: '공통 7차',
      exam_date: '2026-06-17',
      exam_type: 'life',
      is_third_exam: false,
    },
    {
      round_id: 'nonlife-1',
      round_label: '손해 1차',
      exam_date: '2026-06-20',
      exam_type: 'nonlife',
      is_third_exam: false,
    },
  ];

  assert.equal(
    mod.isExamApplicantRoundFilterValid(rows, mod.EXAM_APPLICANT_ALL_FILTER_VALUE, 'life-1'),
    true,
  );
  assert.equal(mod.isExamApplicantRoundFilterValid(rows, 'life:base', 'life-1'), true);
  assert.equal(mod.isExamApplicantRoundFilterValid(rows, 'nonlife:base', 'life-1'), false);
  assert.equal(
    mod.isExamApplicantRoundFilterValid(rows, 'nonlife:base', mod.EXAM_APPLICANT_ALL_FILTER_VALUE),
    true,
  );
});

test('exam applicant table badges and subject column prevent clipped Korean text', async () => {
  const mod = await import('./exam-applicant-list-display.ts').catch(() => null);

  assert.ok(mod, 'exam applicant list display module should exist');

  const subjectColumn = mod.EXAM_APPLICANT_EXPORT_COLUMNS.find(
    (column) => column.key === 'subject_display',
  );
  const applicationTypeColumn = mod.EXAM_APPLICANT_EXPORT_COLUMNS.find(
    (column) => column.key === 'application_type',
  );

  assert.ok(subjectColumn, 'subject_display column should exist');
  assert.ok(applicationTypeColumn, 'application_type column should exist');
  assert.ok(subjectColumn.minWidth >= 170, 'subject badge column must fit 생명보험+제3보험');
  assert.ok(applicationTypeColumn.minWidth >= 150, 'application type column should not split 구분 text');
  assert.equal(mod.EXAM_APPLICANT_TABLE_BADGE_STYLES.root.height, 'auto');
  assert.equal(mod.EXAM_APPLICANT_TABLE_BADGE_STYLES.root.overflow, 'visible');
  assert.equal(mod.EXAM_APPLICANT_TABLE_BADGE_STYLES.label.overflow, 'visible');
  assert.equal(mod.EXAM_APPLICANT_TABLE_BADGE_STYLES.label.wordBreak, 'keep-all');
  assert.equal(mod.EXAM_APPLICANT_TABLE_BADGE_STYLES.label.textOverflow, 'clip');
});

test('round-specific admin exam page uses the shared applicant column contract', () => {
  const source = readFileSync('web/src/app/admin/exams/[id]/page.tsx', 'utf8');

  assert.match(source, /EXAM_APPLICANT_EXPORT_COLUMNS/);
  assert.match(source, /getExamApplicantCellValue/);
  assert.match(source, /roundId=/);
  assert.doesNotMatch(source, /<FilterHeader label="이름" field="name" \/>[\s\S]*<FilterHeader label="연락처" field="phone" \/>[\s\S]*<FilterHeader label="소속" field="affiliation"/);
});

test('all admin applicant table surfaces use shared non-clipping badge styles', () => {
  const sources = [
    readFileSync('web/src/app/dashboard/exam/applicants/page.tsx', 'utf8'),
    readFileSync('web/src/app/admin/exams/[id]/page.tsx', 'utf8'),
  ];

  for (const source of sources) {
    assert.match(source, /EXAM_APPLICANT_TABLE_BADGE_STYLES/);
    assert.doesNotMatch(source, /styles=\{\{\s*label:\s*\{\s*whiteSpace:\s*['"]normal['"]/);
  }
});

test('legacy exam apply route redirects to the canonical applicant list instead of rendering a stale table', () => {
  const source = readFileSync('web/src/app/exam/apply/page.tsx', 'utf8');

  assert.match(source, /redirect\(['"]\/dashboard\/exam\/applicants['"]\)/);
  assert.doesNotMatch(source, /exam_registrations/);
  assert.doesNotMatch(source, /<FilterHeader label="이름" field="name" \/>[\s\S]*<FilterHeader label="연락처" field="phone" \/>/);
  assert.doesNotMatch(source, /<Table\.Th>신청일시<\/Table\.Th>/);
});

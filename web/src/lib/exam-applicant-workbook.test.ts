import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { strFromU8, unzipSync } from 'fflate';
import type { CellObject } from 'write-excel-file/universal';

import {
  buildExamApplicantWorkbookModel,
  createExamApplicantWorkbookBlob,
  type ExamApplicantWorkbookInput,
} from './exam-applicant-workbook.ts';

const headers = [
  '소속',
  '응시자 이름',
  '주민등록번호(전체)',
  '주소',
  '전화번호',
  '시험 신청일',
  '시험응시 과목',
  '시험 신청 구분',
  '접수 상태',
  '생명보험 응시일자',
  '생명보험 고사장',
  '손해보험 응시일자',
  '손해보험 고사장',
  '제3보험 포함 여부',
  '응시료 입금 날짜',
  '입금 증빙 경로',
  '입금 증빙 URL (30일 유효)',
];

const input: ExamApplicantWorkbookInput = {
  headers,
  generatedAt: new Date('2026-07-28T06:30:00.000Z'),
  rows: [
    {
      values: [
        '2본부',
        '테스트 응시자',
        '001-IDENTIFIER',
        '서울시 테스트구',
        '001-PHONE',
        '2026-07-28',
        '생명보험+제3보험',
        '재신청',
        '접수 완료',
        '8월 1차: 08/10 (월)',
        '서울',
        '-',
        '-',
        '포함',
        '2026-07-27',
        'opaque/test/path',
        'https://storage.example.test/proof?token=abc&expires=30',
      ],
      isConfirmed: true,
      proofUrl: 'https://storage.example.test/proof?token=abc&expires=30',
    },
  ],
};

function cellAt(model: ReturnType<typeof buildExamApplicantWorkbookModel>, row: number, column: number) {
  return model.data[row - 1][column - 1] as CellObject;
}

test('exam applicant workbook model preserves identifiers as styled text cells', () => {
  const model = buildExamApplicantWorkbookModel(input);

  assert.equal(cellAt(model, 1, 1).value, '시험 응시자 명단');
  assert.equal(cellAt(model, 1, 1).columnSpan, headers.length);
  assert.equal(cellAt(model, 4, 1).backgroundColor, '#1f2937');
  assert.equal(cellAt(model, 5, 3).value, '001-IDENTIFIER');
  assert.equal(cellAt(model, 5, 3).type, String);
  assert.equal(cellAt(model, 5, 3).format, '@');
  assert.equal(cellAt(model, 5, 5).value, '001-PHONE');
  assert.equal(cellAt(model, 5, 5).format, '@');
  assert.equal(cellAt(model, 5, 9).value, '접수 완료');
  assert.equal(cellAt(model, 5, 9).backgroundColor, '#f37321');
  assert.equal(cellAt(model, 5, 1).backgroundColor, '#fff1e8');
  assert.equal(cellAt(model, 5, 16).backgroundColor, '#fff1e8');
  assert.equal(cellAt(model, 5, 17).value, '증빙 열기 (30일)');
  assert.equal(cellAt(model, 5, 17).textColor, '#2563eb');
  assert.ok(model.data[4].every((cell) => {
    const backgroundColor = (cell as CellObject).backgroundColor;
    return backgroundColor === '#fff1e8' || backgroundColor === '#f37321';
  }));
  assert.deepEqual(model.options, {
    sheet: '시험 응시자 명단',
    orientation: 'landscape',
    stickyRowsCount: 4,
    stickyColumnsCount: 2,
    showGridLines: false,
    zoomScale: 0.9,
    columns: [
      { width: 22 }, { width: 14 }, { width: 20 }, { width: 44 },
      { width: 17 }, { width: 16 }, { width: 22 }, { width: 18 },
      { width: 16 }, { width: 22 }, { width: 18 }, { width: 22 },
      { width: 18 }, { width: 18 }, { width: 18 }, { width: 38 },
      { width: 24 },
    ],
  });
  assert.equal(model.autoFilterRef, 'A4:Q5');
  assert.deepEqual(model.hyperlinkTargets, [{
    cellRef: 'Q5',
    relationshipId: 'rId-exam-proof-1',
    target: 'https://storage.example.test/proof?token=abc&expires=30',
  }]);
});

test('generated exam applicant XLSX contains frozen panes, filter, styles, and external proof link', async () => {
  const blob = await createExamApplicantWorkbookBlob(input);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const relationshipsXml = strFromU8(files['xl/worksheets/_rels/sheet1.xml.rels']);
  const stylesXml = strFromU8(files['xl/styles.xml']);

  assert.equal(
    blob.type,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.match(sheetXml, /<pane[^>]*xSplit="2"/);
  assert.match(sheetXml, /<pane[^>]*ySplit="4"/);
  assert.match(sheetXml, /<pane[^>]*state="frozen"/);
  assert.match(sheetXml, /<autoFilter ref="A4:Q5"\/>/);
  assert.match(sheetXml, /<hyperlink ref="Q5" r:id="rId-exam-proof-1"\/>/);
  assert.match(
    relationshipsXml,
    /Target="https:\/\/storage\.example\.test\/proof\?token=abc&amp;expires=30"/,
  );
  assert.match(
    relationshipsXml,
    /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink"/,
  );
  assert.match(stylesXml, /FFF37321/i);
  assert.match(stylesXml, /FF1F2937/i);
});

test('workbook rejects mismatched columns and ignores non-HTTPS proof links', () => {
  assert.throws(
    () => buildExamApplicantWorkbookModel({
      ...input,
      rows: [{ values: ['열 부족'], isConfirmed: false, proofUrl: null }],
    }),
    /열 개수가 일치하지 않습니다/,
  );

  const model = buildExamApplicantWorkbookModel({
    ...input,
    rows: [{
      values: [...input.rows[0].values.slice(0, -1), 'http://example.test/not-safe'],
      isConfirmed: false,
      proofUrl: 'http://example.test/not-safe',
    }],
  });

  assert.equal(model.hyperlinkTargets.length, 0);
  assert.equal(cellAt(model, 5, 1).backgroundColor, '#f1f5f9');
  assert.equal(cellAt(model, 5, 9).backgroundColor, '#64748b');
  assert.equal(cellAt(model, 5, 17).value, 'http://example.test/not-safe');
  assert.ok(model.data[4].every((cell) => {
    const backgroundColor = (cell as CellObject).backgroundColor;
    return backgroundColor === '#f1f5f9' || backgroundColor === '#64748b';
  }));
});

test('admin applicant page downloads the final filtered rows as a lazy-loaded XLSX', () => {
  const pageSource = readFileSync(
    new URL('../app/dashboard/exam/applicants/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /const workbookRows = filteredRows\.map\(/);
  assert.match(pageSource, /const attachedRegistrationIds = filteredRows/);
  assert.match(pageSource, /item\.is_confirmed \? '접수 완료' : '미접수'/);
  assert.match(pageSource, /isConfirmed: item\.is_confirmed/);
  assert.match(pageSource, /import\(\s*'@\/lib\/exam-applicant-workbook'\s*\)/);
  assert.match(pageSource, /downloadExamApplicantWorkbook\(\{/);
  assert.match(pageSource, /exam_applicants_\$\{dayjs\(\)\.format\('YYYYMMDD'\)\}\.xlsx/);
  assert.doesNotMatch(pageSource, /text\/csv|\.csv/);
});

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
  '신청 상태',
  '생명보험 응시일자',
  '생명보험 고사장',
  '손해보험 응시일자',
  '손해보험 고사장',
  '제3보험 포함 여부',
  '응시료 입금 날짜',
  '접수 상태',
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
        '신청 완료',
        '8월 1차: 08/10 (월)',
        '서울',
        '-',
        '-',
        '포함',
        '2026-07-27',
        '접수 완료',
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
  assert.equal(cellAt(model, 1, 1).backgroundColor, '#ffffff');
  assert.equal(cellAt(model, 1, 1).textColor, '#e85d04');
  assert.equal(cellAt(model, 4, 1).backgroundColor, '#f8fafc');
  assert.equal(cellAt(model, 4, 1).textColor, '#1f2937');
  assert.equal(cellAt(model, 5, 3).value, '001-IDENTIFIER');
  assert.equal(cellAt(model, 5, 3).type, String);
  assert.equal(cellAt(model, 5, 3).format, '@');
  assert.equal(cellAt(model, 5, 5).value, '001-PHONE');
  assert.equal(cellAt(model, 5, 5).format, '@');
  assert.equal(cellAt(model, 5, 9).value, '신청 완료');
  assert.equal(cellAt(model, 5, 9).fontWeight, 'bold');
  assert.equal(cellAt(model, 5, 9).backgroundColor, '#fffbf7');
  assert.equal(cellAt(model, 5, 16).value, '접수 완료');
  assert.equal(cellAt(model, 5, 16).backgroundColor, '#fff7ed');
  assert.equal(cellAt(model, 5, 16).textColor, '#b45309');
  assert.equal(cellAt(model, 5, 1).backgroundColor, '#fffbf7');
  assert.equal(cellAt(model, 5, 17).backgroundColor, '#fffbf7');
  assert.equal(cellAt(model, 5, 18).value, '증빙 열기 (30일)');
  assert.equal(cellAt(model, 5, 18).textColor, '#2563eb');
  assert.ok(model.data[4].every((cell, index) => {
    const backgroundColor = (cell as CellObject).backgroundColor;
    return backgroundColor === (index === 15 ? '#fff7ed' : '#fffbf7');
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
      { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 },
      { width: 38 }, { width: 24 },
    ],
  });
  assert.equal(model.autoFilterRef, 'A4:R5');
  assert.deepEqual(model.hyperlinkTargets, [{
    cellRef: 'R5',
    relationshipId: 'rId-exam-proof-1',
    target: 'https://storage.example.test/proof?token=abc&expires=30',
  }]);
});

test('workbook keeps rejected and cancelled application states separate from reception state', () => {
  for (const applicationStatus of ['반려', '본인 취소', '관리자 취소']) {
    const values = [...input.rows[0].values];
    values[8] = applicationStatus;
    values[15] = '미접수';

    const model = buildExamApplicantWorkbookModel({
      ...input,
      rows: [{ values, isConfirmed: false, proofUrl: null }],
    });

    assert.equal(cellAt(model, 5, 9).value, applicationStatus);
    assert.equal(cellAt(model, 5, 9).fontWeight, 'bold');
    assert.equal(
      cellAt(model, 5, 9).backgroundColor,
      applicationStatus === '반려' ? '#fff8f8' : '#ffffff',
    );
    assert.equal(
      cellAt(model, 5, 9).textColor,
      applicationStatus === '반려' ? '#b91c1c' : '#64748b',
    );
    assert.equal(cellAt(model, 5, 16).value, '미접수');
    assert.equal(cellAt(model, 5, 16).backgroundColor, '#f8fafc');
    assert.equal(cellAt(model, 5, 16).textColor, '#64748b');
    assert.equal(
      cellAt(model, 5, 1).backgroundColor,
      applicationStatus === '반려' ? '#fff8f8' : '#ffffff',
    );
  }
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
  assert.match(sheetXml, /<autoFilter ref="A4:R5"\/>/);
  assert.match(sheetXml, /<hyperlink ref="R5" r:id="rId-exam-proof-1"\/>/);
  assert.match(
    relationshipsXml,
    /Target="https:\/\/storage\.example\.test\/proof\?token=abc&amp;expires=30"/,
  );
  assert.match(
    relationshipsXml,
    /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink"/,
  );
  assert.match(stylesXml, /FFE85D04/i);
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
  assert.equal(cellAt(model, 5, 1).backgroundColor, '#ffffff');
  assert.equal(cellAt(model, 5, 16).backgroundColor, '#f8fafc');
  assert.equal(cellAt(model, 5, 18).value, 'http://example.test/not-safe');
  assert.ok(model.data[4].every((cell, index) => {
    const backgroundColor = (cell as CellObject).backgroundColor;
    return backgroundColor === (index === 15 ? '#f8fafc' : '#ffffff');
  }));
});

test('admin applicant page downloads the final filtered rows as a lazy-loaded XLSX', () => {
  const pageSource = readFileSync(
    new URL('../app/dashboard/exam/applicants/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /const workbookRows = filteredRows\.map\(/);
  assert.match(pageSource, /const attachedRegistrationIds = filteredRows/);
  assert.match(pageSource, /formatExamApplicantReceptionStatus\(item\)/);
  assert.match(pageSource, /EXAM_APPLICANT_EXPORT_COLUMNS\.map\(\(column\) => column\.title\)/);
  assert.match(pageSource, /isConfirmed: item\.is_confirmed/);
  assert.match(pageSource, /import\(\s*'@\/lib\/exam-applicant-workbook'\s*\)/);
  assert.match(pageSource, /downloadExamApplicantWorkbook\(\{/);
  assert.match(pageSource, /exam_applicants_\$\{dayjs\(\)\.format\('YYYYMMDD'\)\}\.xlsx/);
  assert.doesNotMatch(pageSource, /text\/csv|\.csv/);
});

test('export serializes formula-looking values and leading zeros as literal strings', async () => {
  const values = [...input.rows[0].values];
  values[1] = '=1+1';
  values[4] = '0000123';
  const blob = await createExamApplicantWorkbookBlob({
    ...input, rows: [{ values, isConfirmed: false }],
  });
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(sheetXml, /<f[ >]/);
  const strings = Object.entries(files)
    .filter(([name]) => /sharedStrings|worksheets\/sheet1/.test(name))
    .map(([, bytes]) => strFromU8(bytes)).join('');
  assert.match(strings, /=1\+1/);
  assert.match(strings, /0000123/);
});

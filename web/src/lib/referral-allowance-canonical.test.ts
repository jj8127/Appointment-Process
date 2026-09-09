import assert from 'node:assert/strict';
import test from 'node:test';
import type { SheetData } from 'read-excel-file/node';

import { AllowanceWorkbookError, parseAllowanceSheets } from './referral-allowance-workbook.ts';

const metadata = { performanceMonth: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31',
  personnelSourceDate: '2026-08-08', beneficiaryEmployeeCode: '001' };
const baseHeaders = ['원본행', '사번', 'FP명', '상태', '추천인(원본)', '계보포함', '직속상위 사번', '직속상위명',
  '10년미만 보험료', '10~15년미만 보험료', '15년이상 보험료', '15년이상 실효/해지', '15년이상 철회/반송', '15년이상 본인계약',
  '원본 대상업적', '재계산 대상업적', '원본차이', '10%', 'FP별 만원절사', '전파 적용액', '제외/검토 사유', '연결망'];
const genealogyHeaders = ['원본계보', '기준일', '셀', '원본단계', '사번', '이름', '매핑방식', '인사상태', '직급', '직책',
  '직속상위 사번', '직속상위명', '상위자자격', '통합키', '연결망', '비고'];
const baseRow = (code: string, amount = 100000): SheetData[number] =>
  [1, code, '합성 구성원', '재적', '', 'Y', '', '', 0, 0, amount, 0, 0, 0, amount, amount, 0, amount * .1, 10000, 10000, '', '합성 연결망'];
const graphRow = (code: string | null, coordinate: string, depth: number, parent: string | null,
  source = '합성 원본 A', date = '2026-07-30'): SheetData[number] =>
  [source, date, coordinate, depth, code, '합성 구성원', code ? '사번 연결' : '미연결', code ? '재적' : '미연결', code ? 'FP' : null,
    code ? 'FP' : null, parent, null, parent ? '지급대상' : '최상위', code ? `ID:${code}` : `SYN:${source}:${coordinate.slice(1)}:${depth}`, '합성 연결망', ''];
const makeSheets = () => [
  { sheet: 'FP 기초산정', data: [['FP 기초산정'], [], [], [...baseHeaders], baseRow('001'), baseRow('002'), baseRow('003')] as SheetData },
  { sheet: '계보 매핑', data: [['계보 매핑'], [], [], [...genealogyHeaders],
    graphRow('001', 'A1', 1, null), graphRow('002', 'B1', 2, '001'),
    graphRow(null, 'A2', 1, null), graphRow(null, 'B2', 2, null), graphRow('003', 'C2', 3, null)] as SheetData },
];

test('selects the complete beneficiary subtree while preserving unrelated unknown structure during validation', () => {
  const result = parseAllowanceSheets(makeSheets(), metadata);
  assert.deepEqual(result.people.map((person) => [person.employeeCode, person.parentEmployeeCode]), [['001', null], ['002', '001']]);
  assert.deepEqual(result.sourceSnapshotDates, ['2026-07-30', '2026-08-08']);
  assert.equal(result.genealogyAsOf, '2026-07-31');
});

test('rejects an unknown node inside the selected scope rather than deleting or bypassing it', () => {
  const sheets = makeSheets();
  sheets[1].data.push(graphRow(null, 'C1', 3, '002'));
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /선택 범위의 미연결/);
});

test('unifies agreeing mapped duplicates and keeps source dates even beyond the reference date', () => {
  const sheets = makeSheets();
  sheets[1].data.push(graphRow('001', 'A1', 1, null, '합성 원본 B', '2026-08-10'), graphRow('002', 'B1', 2, '001', '합성 원본 B', '2026-08-10'));
  const result = parseAllowanceSheets(sheets, metadata);
  assert.equal(result.people.length, 2);
  assert.deepEqual(result.sourceSnapshotDates, ['2026-07-30', '2026-08-08', '2026-08-10']);
});

test('preserves a merged parent for a duplicate root occurrence before selecting the beneficiary', () => {
  const sheets = makeSheets();
  sheets[1].data[4][10] = '004';
  sheets[1].data.push(graphRow('004', 'A1', 1, null, '합성 원본 B'), graphRow('001', 'B1', 2, '004', '합성 원본 B'));
  const result = parseAllowanceSheets(sheets, metadata);
  assert.deepEqual(result.people.map((person) => person.employeeCode), ['001', '002']);
  assert.equal(result.people[0].parentEmployeeCode, null);
});

test('rejects conflicting parents globally including a branch outside the selected beneficiary', () => {
  const sheets = makeSheets();
  sheets[1].data.push(graphRow('004', 'A1', 1, null, '합성 원본 B'), graphRow('003', 'B1', 2, '004', '합성 원본 B'));
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /상위 관계/);
});

test('rejects merged cycles even outside the selected scope', () => {
  const sheets = makeSheets();
  sheets[1].data.push(graphRow('004', 'A1', 1, '005', '합성 원본 B'), graphRow('005', 'B1', 2, '004', '합성 원본 B'),
    graphRow('005', 'A1', 1, '004', '합성 원본 C'), graphRow('004', 'B1', 2, '005', '합성 원본 C'));
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /순환 관계/);
});

test('rejects changed used headers and does not accept monetary columns merely because values coincide', () => {
  const base = makeSheets();
  [base[0].data[3][8], base[0].data[3][9]] = [base[0].data[3][9], base[0].data[3][8]];
  assert.throws(() => parseAllowanceSheets(base, metadata), /열 구성/);
  const graph = makeSheets();
  [graph[1].data[3][7], graph[1].data[3][8]] = [graph[1].data[3][8], graph[1].data[3][7]];
  assert.throws(() => parseAllowanceSheets(graph, metadata), /열 구성/);
});

test('independently checks original target, cached difference, and six-column target formula', () => {
  for (const column of [14, 16, 10]) {
    const sheets = makeSheets();
    sheets[0].data[4][column] = 123456;
    assert.throws(() => parseAllowanceSheets(sheets, metadata), AllowanceWorkbookError);
  }
});

test('checks source coordinates, integrated keys, and mapped parents without name joins', () => {
  const mismatch = makeSheets(); mismatch[1].data[5][3] = 3;
  assert.throws(() => parseAllowanceSheets(mismatch, metadata), /셀 위치/);
  const key = makeSheets(); key[1].data[5][13] = 'ID:999';
  assert.throws(() => parseAllowanceSheets(key, metadata), /통합키/);
  const parent = makeSheets(); parent[1].data[5][10] = '003';
  assert.throws(() => parseAllowanceSheets(parent, metadata), /직속상위 사번/);
  const duplicate = makeSheets(); duplicate[1].data.push([...duplicate[1].data[5]]);
  assert.throws(() => parseAllowanceSheets(duplicate, metadata), /셀 위치가 중복/);
});

test('checks a visible year and month while allowing the attested legacy title without either', () => {
  assert.equal(parseAllowanceSheets(makeSheets(), metadata).people.length, 2);
  for (const title of ['2025년 6월 업적', '2026년 7월 업적']) {
    const sheets = makeSheets(); sheets[0].data[0][0] = title;
    assert.throws(() => parseAllowanceSheets(sheets, metadata), /업적월/);
  }
  const correct = makeSheets(); correct[0].data[0][0] = '2026년 6월 업적';
  assert.equal(parseAllowanceSheets(correct, metadata).people.length, 2);
});

test('validates actual date values and supports typed Excel dates', () => {
  // The reader returns Date instances although its declaration currently says typeof Date.
  const sheets = makeSheets(); sheets[1].data[4][1] = new Date('2026-07-30T00:00:00Z') as unknown as SheetData[number][number];
  assert.deepEqual(parseAllowanceSheets(sheets, metadata).sourceSnapshotDates, ['2026-07-30', '2026-08-08']);
  assert.throws(() => parseAllowanceSheets(makeSheets(), { ...metadata, personnelSourceDate: '2026-02-30' }), /원본 기준일/);
  const invalidDate = makeSheets(); invalidDate[1].data[4][1] = '2026-02-30';
  assert.throws(() => parseAllowanceSheets(invalidDate, metadata), /원본 기준일/);
});

test('requires performance evidence for selected descendants but not the noncontributing root', () => {
  const missingRoot = makeSheets(); missingRoot[0].data.splice(4, 1);
  const result = parseAllowanceSheets(missingRoot, metadata);
  assert.equal(result.people[0].finalTargetPerformanceKrw, 0);
  assert.equal(result.people[0].activeAtPerformance, false);
  const missingChild = makeSheets(); missingChild[0].data.splice(5, 1);
  assert.throws(() => parseAllowanceSheets(missingChild, metadata), /선택 범위의 업적 자료/);
});

test('preserves exactly ten edges and does not inspect an eleventh-level unknown as a selected person', () => {
  const sheets = makeSheets(); sheets[1].data.splice(5);
  for (let depth = 1; depth <= 10; depth++) {
    const code = `level-${depth}`;
    sheets[0].data.push(baseRow(code));
    sheets[1].data.push(graphRow(code, `${String.fromCharCode(65 + depth)}1`, depth + 1, depth === 1 ? '001' : `level-${depth - 1}`));
  }
  sheets[1].data.push(graphRow(null, 'L1', 12, 'level-10'));
  const result = parseAllowanceSheets(sheets, metadata);
  assert.equal(result.people.length, 11);
  assert.equal(result.people.at(-1)?.employeeCode, 'level-10');
});

test('never echoes source identity or raw values in a validation error', () => {
  const sheets = makeSheets(); sheets[1].data[5][13] = 'private-source-identifier';
  assert.throws(() => parseAllowanceSheets(sheets, metadata), (error: unknown) =>
    error instanceof AllowanceWorkbookError && !error.message.includes('private-source-identifier') && !error.message.includes('합성 구성원'));
});

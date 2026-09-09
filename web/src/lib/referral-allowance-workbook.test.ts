import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import writeExcelFile, { type SheetData as WriteSheetData } from 'write-excel-file/node';
import type { SheetData } from 'read-excel-file/node';

import { AllowanceWorkbookError, parseAllowanceSheets, parseAllowanceWorkbook, validateAllowanceArchive } from './referral-allowance-workbook.ts';

const metadata = { performanceMonth: '2026-06', paymentDate: '2026-08-01', genealogyAsOf: '2026-06-30', beneficiaryEmployeeCode: '0001', personnelSourceDate: '2026-08-08' };
const headings = ['사번', '직속상위사번', '이름', '소속', '업적기준재적', '기준일재적', '기준일직급', '최종대상업적'];
const makeSheets = () => [
  { sheet: '산정정보', data: [['업적월', '2026-06'], ['실제지급일', '2026-08-01'], ['계보기준일', '2026-06-30'], ['인사원본기준일', '2026-08-08'], ['원본기준일목록', '2026-07-29,2026-08-24']] as SheetData },
  { sheet: '월별 산정자료', data: [[...headings], ['0001', null, '합성 상위', '합성조직', '재적', '재적', 'FP', 0], ['0002', '0001', '합성 하위', '합성조직', '재적', '재적', 'FP', -123456.25]] as SheetData },
];

test('normalizes month-end eligibility and keeps textual employee codes and signed decimal source money', () => {
  const input = parseAllowanceSheets(makeSheets(), metadata);
  assert.equal(input.people[0].employeeCode, '0001');
  assert.equal(input.people[1].finalTargetPerformanceKrw, -123456.25);
  assert.equal(input.people[1].activeAtBasisDate, true);
  assert.equal(input.genealogyAsOf, '2026-06-30');
  assert.deepEqual(input.sourceSnapshotDates, ['2026-07-29', '2026-08-08', '2026-08-24']);
});

test('rejects numeric identifiers rather than losing leading zeros', () => {
  const sheets = makeSheets(); sheets[1].data[1][0] = 1;
  assert.throws(() => parseAllowanceSheets(sheets, metadata), AllowanceWorkbookError);
});

test('rejects missing source amount rather than treating it as zero', () => {
  const sheets = makeSheets(); sheets[1].data[2][7] = null;
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /대상업적/);
});

test('rejects unknown eligibility status and duplicate header columns', () => {
  const sheets = makeSheets(); sheets[1].data[2][5] = '미확인';
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /재적 여부/);
  const duplicate = makeSheets(); duplicate[1].data[0].push('사번');
  assert.throws(() => parseAllowanceSheets(duplicate, metadata), /중복/);
});

test('rejects month/date relabelling and duplicate metadata', () => {
  assert.throws(() => parseAllowanceSheets(makeSheets(), { ...metadata, performanceMonth: '2026-07' }), /일치/);
  assert.throws(() => parseAllowanceSheets(makeSheets(), { ...metadata, genealogyAsOf: '2026-08-01' }), /일치/);
  const sheets = makeSheets(); sheets[0].data.push(['업적월', '2026-06']);
  assert.throws(() => parseAllowanceSheets(sheets, metadata), /일치/);
});

test('imports an actual synthetic XLSX through archive validation and the parser', async () => {
  const buffer = await writeExcelFile(makeSheets().map((sheet) => ({ sheet: sheet.sheet, data: sheet.data as WriteSheetData }))).toBuffer();
  const input = await parseAllowanceWorkbook(buffer, metadata);
  assert.equal(input.people.length, 2);
  assert.equal(input.people[1].employeeCode, '0002');
});

const minimalZip = (worksheet: string, extra: Record<string, Uint8Array> = {}) => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>'),
  'xl/worksheets/sheet1.xml': strToU8(worksheet), ...extra,
}));

test('rejects archive expansion, dangerous XML and active external content before parsing', () => {
  assert.throws(() => validateAllowanceArchive(Buffer.alloc(9 * 1024 * 1024)), /8MB/);
  assert.throws(() => validateAllowanceArchive(minimalZip('<!DOCTYPE root><worksheet/>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet/>', { 'xl/vbaProject.bin': strToU8('macro') })), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet/>', { 'xl/_rels/workbook.xml.rels': strToU8('<Relationship TargetMode="External"/>') })), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><c r="XFD1048576"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><c r="E&#65;1"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><c r="A&#49;"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><row r="&#49;"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><c r="DX50000"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet><c r="A1" p:r="EA1" xmlns:p="urn:synthetic"/></worksheet>')), AllowanceWorkbookError);
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet/>', { 'xl/custom.xml': strToU8('<worksheet><c r="EA1"/></worksheet>') })), AllowanceWorkbookError);
});

test('rejects forged compressed size metadata rather than allocating from untrusted size', () => {
  const buffer = minimalZip(`<worksheet>${'A'.repeat(100_000)}</worksheet>`);
  let central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (central >= 0) {
    const nameLength = buffer.readUInt16LE(central + 28);
    const name = buffer.toString('utf8', central + 46, central + 46 + nameLength);
    if (name === 'xl/worksheets/sheet1.xml') { buffer.writeUInt32LE(10, central + 24); break; }
    central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4);
  }
  assert.throws(() => validateAllowanceArchive(buffer), AllowanceWorkbookError);
});

test('accepts ordinary chart XML and namespace declarations without treating chart tags as worksheet cells', () => {
  assert.doesNotThrow(() => validateAllowanceArchive(minimalZip('<worksheet><c xmlns:r="urn:relationships" r="A1"/></worksheet>', {
    'xl/charts/chart1.xml': strToU8('<c:chartSpace xmlns:c="urn:chart" xmlns:r="urn:relationships"><c:chart/></c:chartSpace>'),
  })));
});

test('imports a workbook with legitimate drawing row anchors without interpreting them as spreadsheet coordinates', async () => {
  const original = await writeExcelFile(makeSheets().map((sheet) => ({ sheet: sheet.sheet, data: sheet.data as WriteSheetData }))).toBuffer();
  const entries = unzipSync(original);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  entries[sheetPath] = strToU8(strFromU8(entries[sheetPath]).replace('</worksheet>',
    `<drawing xmlns:r="${relationshipsNamespace}" r:id="rIdDrawing"/></worksheet>`));
  entries['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="${relationshipsNamespace}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  entries['xl/drawings/drawing1.xml'] = strToU8(
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="1" name="Synthetic shape"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
  entries['[Content_Types].xml'] = strToU8(strFromU8(entries['[Content_Types].xml']).replace('</Types>',
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  const input = await parseAllowanceWorkbook(Buffer.from(zipSync(entries)), metadata);
  assert.deepEqual(input, parseAllowanceSheets(makeSheets(), metadata));
});

test('bounds local-name sheetData in custom XML even without a worksheet root and after sheetData closes', () => {
  const customXml = '<custom xmlns:s="urn:synthetic"><s:sheetData/><s:row r="50001"/></custom>';
  assert.throws(() => validateAllowanceArchive(minimalZip('<worksheet/>', {
    'xl/custom.xml': strToU8(customXml),
  })), AllowanceWorkbookError);
});

test('validation errors do not echo source personnel content', () => {
  const sheets = makeSheets(); sheets[1].data[2][7] = 'private-source-value';
  assert.throws(() => parseAllowanceSheets(sheets, metadata), (error: unknown) => error instanceof AllowanceWorkbookError && !error.message.includes('private-source-value') && !error.message.includes('합성 하위'));
});

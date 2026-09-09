import { crc32, inflateRawSync } from 'node:zlib';
import { zipSync } from 'fflate';
import readExcelFile, { type CellValue as ExcelCellValue, type SheetData } from 'read-excel-file/node';

import type { ReferralAllowanceCalculationInput as ReferralAllowanceInput, ReferralAllowancePersonInput as ReferralAllowancePerson } from '@shared/types/referral-allowance';

export const ALLOWANCE_MAX_FILE_BYTES = 8 * 1024 * 1024;
type CellValue = ExcelCellValue | null | undefined;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 256;

export class AllowanceWorkbookError extends Error {
  constructor(message: string) { super(message); this.name = 'AllowanceWorkbookError'; }
}

function invalid(message = '지원하는 증원수당 엑셀 파일을 확인해주세요.'): never {
  throw new AllowanceWorkbookError(message);
}

// Check the actual inflated size before giving the archive to an XLSX parser.
// Reject ZIP64, encryption, duplicate paths and non-workbook active content.
export function validateAllowanceArchive(bytes: Buffer): Buffer {
  if (bytes.length < 22 || bytes.length > ALLOWANCE_MAX_FILE_BYTES) invalid('엑셀 파일은 8MB 이하여야 합니다.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  const centralSize = bytes.readUInt32LE(end + 12);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || !count || count > MAX_ENTRIES
    || start + centralSize !== end) invalid();
  let cursor = start;
  let total = 0;
  let totalCells = 0;
  let totalGridCells = 0;
  const paths = new Set<string>();
  const verifiedEntries: Record<string, Uint8Array> = Object.create(null);
  const ranges: Array<[number, number]> = [];
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) invalid();
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if ((flags & 1) || ![0, 8].includes(method) || !name || paths.has(name)
      || name.includes('..') || name.startsWith('/') || name.includes('\\')
      || /vbaproject|externallinks|embeddings|activex/i.test(name)
      || expanded > MAX_EXPANDED_BYTES || local + 30 > start) invalid();
    paths.add(name);
    total += expanded;
    if (total > MAX_EXPANDED_BYTES || bytes.readUInt32LE(local) !== 0x04034b50
      || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
    const localNameLength = bytes.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start
      || bytes.toString('utf8', local + 30, local + 30 + localNameLength) !== name) invalid();
    for (const [offset, expected] of [[14, checksum], [18, compressed], [22, expanded]]) {
      const localValue = bytes.readUInt32LE(local + offset);
      if (localValue !== expected && !((flags & 8) && localValue === 0)) invalid();
    }
    ranges.push([local, dataStart + compressed]);
    let content: Buffer;
    try {
      content = method === 0 ? bytes.subarray(dataStart, dataStart + compressed)
        : inflateRawSync(bytes.subarray(dataStart, dataStart + compressed), { maxOutputLength: Math.max(1, expanded) });
    } catch { invalid(); }
    if (content.length !== expanded || crc32(content) !== checksum) invalid();
    verifiedEntries[name] = content;
    if (/\.xml(?:\.rels)?$|\.rels$/i.test(name)) {
      const xml = content.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /TargetMode\s*=\s*["']External["']/i.test(xml)) invalid('외부 연결이 없는 엑셀 파일을 사용해주세요.');
      // read-excel-file starts allocating rows only after a local-name sheetData
      // tag and retains that state until the document ends. Inspect the entire
      // candidate XML, including custom relationship targets; drawing xdr:row
      // anchors in separate XML documents are not spreadsheet rows. Keep bare
      // worksheet documents bounded too, before the reader rejects their shape.
      if (/<(?:[A-Za-z_][\w.-]*:)?(?:worksheet|sheetData)(?=[\s/>])/.test(xml)) {
        let maximumColumn = 0;
        let maximumRow = 0;
        for (const tag of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?c(?=[\s/>])[^>]*>/g)) {
          if ([...tag[0].matchAll(/\s+([A-Za-z_][\w.-]*):r\s*=/g)].some((attribute) => attribute[1] !== 'xmlns')) invalid();
          const references = [...tag[0].matchAll(/\s+r\s*=\s*(["'])(.*?)\1/g)];
          if (references.length !== 1) invalid();
          const match = /^([A-Z]+)([1-9]\d*)$/.exec(references[0][2]);
          // Entity-encoded coordinates must not evade the allocation bounds.
          if (!match) invalid();
          let column = 0;
          for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
          totalCells++;
          if (column > 128 || Number(match[2]) > 50_000 || totalCells > 250_000) invalid('엑셀의 행·열 범위가 업로드 한도를 초과했습니다.');
          maximumColumn = Math.max(maximumColumn, column);
          maximumRow = Math.max(maximumRow, Number(match[2]));
        }
        for (const tag of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row(?=[\s/>])[^>]*>/g)) {
          if ([...tag[0].matchAll(/\s+([A-Za-z_][\w.-]*):r\s*=/g)].some((attribute) => attribute[1] !== 'xmlns')) invalid();
          const references = [...tag[0].matchAll(/\s+r\s*=\s*(["'])(.*?)\1/g)];
          if (references.length !== 1 || !/^[1-9]\d*$/.test(references[0][2]) || Number(references[0][2]) > 50_000) invalid();
          maximumRow = Math.max(maximumRow, Number(references[0][2]));
        }
        totalGridCells += maximumColumn * maximumRow;
        if (totalGridCells > 1_000_000) invalid('엑셀의 빈 행·열 범위를 정리한 뒤 다시 업로드해주세요.');
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) invalid();
  if (cursor !== end || !paths.has('xl/workbook.xml') || !paths.has('[Content_Types].xml')) invalid();
  // The downstream reader never sees the original ZIP metadata. Re-encoding
  // validated, bounded entries prevents local/central-header parser differences.
  return Buffer.from(zipSync(verifiedEntries, { level: 0 }));
}

type ImportMetadata = Pick<ReferralAllowanceInput, 'performanceMonth' | 'paymentDate' | 'genealogyAsOf' | 'beneficiaryEmployeeCode'> & { personnelSourceDate: string };
type WorkbookSheet = { sheet: string; data: SheetData };
const normalizeHeader = (value: CellValue) => String(value ?? '').replace(/\s/g, '');
function textCell(value: CellValue, label: string, row: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 160) invalid(`${row}행 ${label}은 문자열로 입력해주세요.`);
  return value.trim();
}
function codeCell(value: CellValue, row: number, allowEmpty = false): string | null {
  if (allowEmpty && (value == null || value === '')) return null;
  const code = textCell(value, '사번', row);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) invalid(`${row}행 사번 형식을 확인해주세요.`);
  return code;
}
function moneyCell(value: CellValue, row: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) invalid(`${row}행 대상업적은 유효한 숫자여야 합니다.`);
  return value;
}
function booleanCell(value: CellValue, row: number): boolean {
  if (value === true || value === '재적') return true;
  if (value === false || value === '해촉') return false;
  invalid(`${row}행 재적 여부는 재적 또는 해촉으로 입력해주세요.`);
}
function headerTable(sheet: WorkbookSheet, headers: string[]): SheetData {
  const head = sheet.data.findIndex((row, index) => index < 10 && headers.every((h) => row.some((v) => normalizeHeader(v) === h)));
  if (head < 0) invalid('엑셀 열 구성이 지원 양식과 다릅니다.');
  const indexes = headers.map((h) => {
    const matches = sheet.data[head].map(normalizeHeader).flatMap((v, i) => v === h ? [i] : []);
    if (matches.length !== 1) invalid('중복된 제목 열이 있습니다.');
    return matches[0];
  });
  return sheet.data.slice(head + 1).filter((row) => row.some((v) => v != null && v !== '')).map((row) => indexes.map((index) => row[index] ?? null));
}

export function parseAllowanceSheets(sheets: WorkbookSheet[], metadata: ImportMetadata): ReferralAllowanceInput {
  if (new Set(sheets.map((s) => s.sheet)).size !== sheets.length) invalid();
  const normalized = sheets.find((s) => s.sheet === '월별 산정자료');
  if (normalized) {
    const info = sheets.find((s) => s.sheet === '산정정보');
    if (!info) invalid('산정정보 시트가 필요합니다.');
    for (const [label, expected] of [['업적월', metadata.performanceMonth], ['실제지급일', metadata.paymentDate], ['계보기준일', metadata.genealogyAsOf], ['인사원본기준일', metadata.personnelSourceDate]]) {
      const matches = info.data.filter((r) => normalizeHeader(r[0]) === label);
      if (matches.length !== 1 || matches[0][1] !== expected) invalid('산정정보의 업적월·지급일·계보기준일이 입력값과 일치하지 않습니다.');
    }
    const sourceDateRows = info.data.filter((r) => normalizeHeader(r[0]) === '원본기준일목록');
    if (sourceDateRows.length !== 1 || typeof sourceDateRows[0][1] !== 'string') invalid('산정정보에 실제 원본 기준일 목록을 입력해주세요.');
    const sourceDates = sourceDateRows[0][1].split(',').map((date) => date.trim());
    if (!sourceDates.length || sourceDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) invalid('실제 원본 기준일은 YYYY-MM-DD 형식으로 쉼표로 구분해주세요.');
    const rows = headerTable(normalized, ['사번', '직속상위사번', '이름', '소속', '업적기준재적', '기준일재적', '기준일직급', '최종대상업적']);
    if (rows.length > 5000) invalid('산정 인원은 5,000명 이하여야 합니다.');
    const people: ReferralAllowancePerson[] = rows.map((r, i) => ({
      employeeCode: codeCell(r[0], i + 2)!, parentEmployeeCode: codeCell(r[1], i + 2, true),
      name: textCell(r[2], '이름', i + 2), affiliation: r[3] == null ? '' : textCell(r[3], '소속', i + 2, true),
      activeAtPerformance: booleanCell(r[4], i + 2), activeAtBasisDate: booleanCell(r[5], i + 2),
      rankAtBasisDate: textCell(r[6], '기준일직급', i + 2), finalTargetPerformanceKrw: moneyCell(r[7], i + 2),
    }));
    return { ...metadata, sourceSnapshotDates: [...new Set([...sourceDates, metadata.personnelSourceDate])].sort(), people };
  }
  return parseRecalculatedWorkbook(sheets, metadata);
}

function parseRecalculatedWorkbook(sheets: WorkbookSheet[], metadata: ImportMetadata): ReferralAllowanceInput {
  const base = sheets.find((s) => s.sheet === 'FP 기초산정');
  const genealogy = sheets.find((s) => s.sheet === '계보 매핑');
  if (!base || !genealogy) invalid('월별 산정자료 양식 또는 계보10단계 재계산 파일을 사용해주세요.');
  // The legacy source has no embedded year/payment/HR snapshot metadata. Those
  // dates are operator-attested by the upload flow; any visible year/month must agree.
  const title = base.data.slice(0, 3).flat().filter((v) => typeof v === 'string').join(' ');
  for (const match of title.matchAll(/(?:(20\d{2})년\s*)?(\d{1,2})월\s*업적/g)) {
    if (Number(match[2]) !== Number(metadata.performanceMonth.slice(5))
      || (match[1] && Number(match[1]) !== Number(metadata.performanceMonth.slice(0, 4)))) invalid('파일 제목의 업적월과 선택한 업적월이 일치하지 않습니다.');
  }
  const baseHeaders = ['원본행', '사번', 'FP명', '상태', '추천인(원본)', '계보포함', '직속상위 사번', '직속상위명',
    '10년미만 보험료', '10~15년미만 보험료', '15년이상 보험료', '15년이상 실효/해지', '15년이상 철회/반송', '15년이상 본인계약',
    '원본 대상업적', '재계산 대상업적', '원본차이', '10%', 'FP별 만원절사', '전파 적용액', '제외/검토 사유', '연결망'];
  const genealogyHeaders = ['원본계보', '기준일', '셀', '원본단계', '사번', '이름', '매핑방식', '인사상태', '직급', '직책',
    '직속상위 사번', '직속상위명', '상위자자격', '통합키', '연결망', '비고'];
  for (const [sheet, headers] of [[base, baseHeaders], [genealogy, genealogyHeaders]] as const) {
    if (headers.some((header, i) => normalizeHeader(sheet.data[3]?.[i]) !== normalizeHeader(header))) invalid('재계산 파일의 열 구성을 확인해주세요.');
  }
  const performance = new Map<string, { active: boolean; amount: number }>();
  for (const [i, r] of base.data.slice(4).entries()) {
    if (r.every((v) => v == null || v === '')) continue;
    if (r[1] == null && String(r[0] ?? '').includes('합계')) continue;
    const rowNumber = i + 5;
    const code = codeCell(r[1], rowNumber)!;
    if (performance.has(code)) invalid(`${rowNumber}행 사번이 중복되었습니다.`);
    const original = moneyCell(r[14], rowNumber);
    const amount = moneyCell(r[15], rowNumber);
    const difference = moneyCell(r[16], rowNumber);
    if (difference !== 0 || Math.abs(original - amount) > 0.00001) invalid(`${rowNumber}행 원본차이가 0이 아닙니다. 검토 후 다시 업로드해주세요.`);
    // Independently verify cached targets and their source columns; never execute formulas.
    const [shortPremium, mediumPremium, longPremium, lapse, withdrawal, selfContract] = [8, 9, 10, 11, 12, 13].map((col) => moneyCell(r[col], rowNumber));
    const expected = longPremium - lapse - withdrawal - selfContract + shortPremium * 0.25 + mediumPremium * 0.5;
    if (Math.abs(expected - amount) > 0.00001) invalid(`${rowNumber}행 대상업적이 원천 열 계산과 일치하지 않습니다.`);
    textCell(r[2], '이름', rowNumber);
    performance.set(code, { active: booleanCell(r[3], rowNumber), amount });
  }
  if (performance.size > 5000) invalid('산정 인원은 5,000명 이하여야 합니다.');

  const snapshotDate = (value: CellValue, rowNumber: number): string => {
    let date = '';
    if (value instanceof Date && Number.isFinite(value.getTime())) date = value.toISOString().slice(0, 10);
    else if (typeof value === 'string') date = value.trim();
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) invalid(`${rowNumber}행 원본 기준일을 확인해주세요.`);
    return date;
  };
  const sourceDates = new Set<string>([snapshotDate(metadata.personnelSourceDate, 0)]);
  type SourceNode = {
    key: string; code: string | null; name: string; active: boolean | null; rank: string | null;
    rowNumber: number; sourceRow: number; sourceColumn: number; declaredParent: string | null; group: string;
  };
  const groups = new Map<string, SourceNode[]>();
  const nodesByKey = new Map<string, SourceNode>();
  const occurrences: SourceNode[] = [];
  for (const [i, r] of genealogy.data.slice(4).entries()) {
    if (r.every((v) => v == null || v === '')) continue;
    const rowNumber = i + 5;
    const source = textCell(r[0], '원본계보', rowNumber);
    const date = snapshotDate(r[1], rowNumber);
    sourceDates.add(date);
    const coordinate = /^([A-Z]+)([1-9]\d*)$/.exec(textCell(r[2], '원본 셀', rowNumber));
    if (!coordinate) invalid(`${rowNumber}행 원본 셀 위치를 확인해주세요.`);
    let sourceColumn = 0;
    for (const char of coordinate[1]) sourceColumn = sourceColumn * 26 + char.charCodeAt(0) - 64;
    const sourceRow = Number(coordinate[2]);
    if (sourceColumn > 128 || sourceRow > 50000 || r[3] !== sourceColumn) invalid(`${rowNumber}행 원본단계와 셀 위치가 일치하지 않습니다.`);
    const code = codeCell(r[4], rowNumber, true);
    const key = textCell(r[13], '통합키', rowNumber);
    if (code !== null ? key !== `ID:${code}` : !key.startsWith('SYN:') || !key.endsWith(`:${sourceRow}:${sourceColumn}`)) invalid(`${rowNumber}행 통합키와 원본 식별정보가 일치하지 않습니다.`);
    const group = JSON.stringify([source, date]);
    const node: SourceNode = {
      key, code, name: textCell(r[5], '이름', rowNumber),
      active: code === null ? null : booleanCell(r[7], rowNumber),
      rank: code === null ? null : textCell(r[8], '기준일직급', rowNumber),
      rowNumber, sourceRow, sourceColumn, declaredParent: codeCell(r[10], rowNumber, true), group,
    };
    if (code === null && r[7] !== '미연결') invalid(`${rowNumber}행 미연결 인사정보를 확인해주세요.`);
    const existing = nodesByKey.get(key);
    if (existing && (code === null || existing.code !== code || existing.name !== node.name || existing.active !== node.active || existing.rank !== node.rank)) invalid(`${rowNumber}행 중복 계보의 인사정보가 다릅니다.`);
    if (!existing) nodesByKey.set(key, node);
    const members = groups.get(group) ?? [];
    members.push(node);
    groups.set(group, members);
    occurrences.push(node);
  }
  if (!nodesByKey.size || nodesByKey.size > 5000 || occurrences.length > 10000 || sourceDates.size > 64) invalid('계보의 인원·원본 수가 업로드 한도를 초과했습니다.');

  // Reconstruct the source's row-major grid before selecting the beneficiary.
  // Unknown nodes retain their SYN keys and every edge; their names are never joins.
  const parents = new Map<string, string>();
  for (const members of groups.values()) {
    members.sort((a, b) => a.sourceRow - b.sourceRow || a.sourceColumn - b.sourceColumn);
    const stack = new Map<number, string>();
    let priorCoordinate = '';
    for (const node of members) {
      const coordinate = `${node.sourceRow}:${node.sourceColumn}`;
      if (coordinate === priorCoordinate) invalid(`${node.rowNumber}행 원본 셀 위치가 중복되었습니다.`);
      priorCoordinate = coordinate;
      const parent = node.sourceColumn > 1 ? stack.get(node.sourceColumn - 1) : undefined;
      if (node.sourceColumn > 1 && !parent) invalid(`${node.rowNumber}행 원본 계보의 중간 단계가 없습니다.`);
      if (parent) {
        const existing = parents.get(node.key);
        if (existing && existing !== parent) invalid(`${node.rowNumber}행 중복 계보의 상위 관계가 다릅니다.`);
        parents.set(node.key, parent);
      }
      // A root occurrence in another chart does not erase a known merged parent.
      stack.set(node.sourceColumn, node.key);
      for (const column of stack.keys()) if (column > node.sourceColumn) stack.delete(column);
    }
  }
  for (const node of occurrences) {
    const parentKey = parents.get(node.key);
    const parentCode = parentKey ? nodesByKey.get(parentKey)!.code : null;
    if (node.declaredParent !== parentCode) invalid(`${node.rowNumber}행 직속상위 사번이 원본 계보와 일치하지 않습니다.`);
  }
  const completed = new Set<string>();
  for (const node of nodesByKey.values()) {
    const path = new Set<string>();
    let current: string | undefined = node.key;
    while (current && !completed.has(current)) {
      if (path.has(current)) invalid(`${node.rowNumber}행 계보에 순환 관계가 있습니다.`);
      path.add(current);
      current = parents.get(current);
    }
    for (const key of path) completed.add(key);
  }
  const beneficiaryKey = `ID:${metadata.beneficiaryEmployeeCode}`;
  if (!nodesByKey.has(beneficiaryKey)) invalid('지정된 수령자의 사번이 계보에 없습니다.');
  const children = new Map<string, string[]>();
  for (const [key, parent] of parents) {
    const siblings = children.get(parent) ?? [];
    siblings.push(key);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort();
  const queue = [{ key: beneficiaryKey, parentCode: null as string | null, depth: 0 }];
  const people: ReferralAllowancePerson[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const node = nodesByKey.get(item.key)!;
    if (node.code === null || node.active === null || node.rank === null) invalid(`${node.rowNumber}행 선택 범위의 미연결 인사를 확인해주세요.`);
    const perf = performance.get(node.code);
    if (!perf && item.depth > 0) invalid(`${node.rowNumber}행 선택 범위의 업적 자료가 없습니다.`);
    // The selected root never contributes its own target to this statement.
    people.push({ employeeCode: node.code, parentEmployeeCode: item.parentCode, name: node.name, affiliation: '',
      activeAtPerformance: perf?.active ?? false, activeAtBasisDate: node.active, rankAtBasisDate: node.rank,
      finalTargetPerformanceKrw: perf?.amount ?? 0 });
    if (item.depth < 10) for (const key of children.get(item.key) ?? []) queue.push({ key, parentCode: node.code, depth: item.depth + 1 });
  }
  return { performanceMonth: metadata.performanceMonth, paymentDate: metadata.paymentDate, genealogyAsOf: metadata.genealogyAsOf,
    beneficiaryEmployeeCode: metadata.beneficiaryEmployeeCode, sourceSnapshotDates: [...sourceDates].sort(), people };
}

export async function parseAllowanceWorkbook(bytes: Buffer, metadata: ImportMetadata): Promise<ReferralAllowanceInput> {
  const safeArchive = validateAllowanceArchive(bytes);
  let sheets: WorkbookSheet[];
  try { sheets = await readExcelFile(safeArchive); } catch { invalid('엑셀 내용을 읽을 수 없습니다. 파일 형식을 확인해주세요.'); }
  return parseAllowanceSheets(sheets, metadata);
}

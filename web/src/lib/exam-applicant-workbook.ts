import writeExcelFile, {
  type CellObject,
  type Feature,
  type SheetData,
  type SheetOptions,
} from 'write-excel-file/universal';
import {
  appendMarkupInsideElement,
  findElement,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
  sanitizeAttributeValue,
} from 'write-excel-file/utility';

const WORKSHEET_RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

const HEADER_ROW = 4;
const DATA_START_ROW = 5;

const COLORS = {
  orange: '#f37321',
  orangeSoft: '#fff1e8',
  charcoal: '#1f2937',
  muted: '#64748b',
  pending: '#64748b',
  pendingSoft: '#f1f5f9',
  border: '#d7dee8',
  white: '#ffffff',
  blue: '#2563eb',
} as const;

export type ExamApplicantWorkbookRow = {
  values: string[];
  isConfirmed: boolean;
  proofUrl?: string | null;
};

export type ExamApplicantWorkbookInput = {
  headers: string[];
  rows: ExamApplicantWorkbookRow[];
  generatedAt: Date;
};

export type ExamApplicantWorkbookModel = {
  data: SheetData;
  options: SheetOptions<Blob>;
  features: Feature<Blob>[];
  hyperlinkTargets: Array<{
    cellRef: string;
    relationshipId: string;
    target: string;
  }>;
  autoFilterRef: string;
};

function toColumnName(columnNumber: number): string {
  let value = columnNumber;
  let name = '';

  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }

  return name;
}

function isSafeHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function createTextCell(
  value: string,
  options: Partial<CellObject> = {},
): CellObject {
  return {
    value,
    type: String,
    format: '@',
    fontFamily: '맑은 고딕',
    fontSize: 10,
    alignVertical: 'center',
    borderStyle: 'thin',
    borderColor: COLORS.border,
    ...options,
  };
}

function createWorksheetEnhancementFeature({
  autoFilterRef,
  hyperlinks,
}: {
  autoFilterRef: string;
  hyperlinks: ExamApplicantWorkbookModel['hyperlinkTargets'];
}): Feature<Blob> {
  const relationshipMarkup = hyperlinks
    .map(({ relationshipId, target }) => (
      `<Relationship Id="${sanitizeAttributeValue(relationshipId)}" `
      + `Type="${HYPERLINK_RELATIONSHIP_TYPE}" `
      + `Target="${sanitizeAttributeValue(target)}" TargetMode="External"/>`
    ))
    .join('');

  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transformElementAttributes(tagName, attributes) {
            if (tagName !== 'worksheet' || hyperlinks.length === 0) {
              return attributes;
            }
            return {
              ...attributes,
              'xmlns:r': WORKSHEET_RELATIONSHIP_NAMESPACE,
            };
          },
          transform(content, _options, { sheetIndex }) {
            if (sheetIndex !== 0) return content;

            const order = getOrderOfSiblings(
              'xl/worksheets/sheet{id}.xml',
              'worksheet',
            );
            if (!order) return content;

            let next = insertElementMarkupAccordingToOrderOfSiblings(
              content,
              `<autoFilter ref="${sanitizeAttributeValue(autoFilterRef)}"/>`,
              order,
              'worksheet',
            );

            if (hyperlinks.length > 0) {
              const hyperlinkMarkup = hyperlinks
                .map(({ cellRef, relationshipId }) => (
                  `<hyperlink ref="${sanitizeAttributeValue(cellRef)}" `
                  + `r:id="${sanitizeAttributeValue(relationshipId)}"/>`
                ))
                .join('');
              next = insertElementMarkupAccordingToOrderOfSiblings(
                next,
                `<hyperlinks>${hyperlinkMarkup}</hyperlinks>`,
                order,
                'worksheet',
              );
            }

            return next;
          },
        },
        'xl/worksheets/_rels/sheet{id}.xml.rels': {
          transform(content, _options, { sheetIndex }) {
            if (sheetIndex !== 0 || hyperlinks.length === 0) return content;
            const relationships = findElement(content, 'Relationships');
            if (
              !relationships
              || relationships.openingTagAttributes.xmlns !== PACKAGE_RELATIONSHIP_NAMESPACE
            ) {
              throw new Error('시험 응시자 엑셀 관계 파일이 예상과 다릅니다.');
            }
            return appendMarkupInsideElement(content, relationships, relationshipMarkup);
          },
        },
      },
    },
  };
}

export function buildExamApplicantWorkbookModel({
  headers,
  rows,
  generatedAt,
}: ExamApplicantWorkbookInput): ExamApplicantWorkbookModel {
  if (headers.length === 0) {
    throw new Error('시험 응시자 엑셀 헤더가 비어 있습니다.');
  }
  if (rows.some((row) => row.values.length !== headers.length)) {
    throw new Error('시험 응시자 엑셀 열 개수가 일치하지 않습니다.');
  }

  const columnCount = headers.length;
  const subjectColumnIndex = headers.indexOf('시험응시 과목');
  const applicationTypeColumnIndex = headers.indexOf('시험 신청 구분');
  const receptionStatusColumnIndex = headers.indexOf('접수 상태');
  const thirdExamColumnIndex = headers.indexOf('제3보험 포함 여부');
  if (receptionStatusColumnIndex < 0) {
    throw new Error('시험 응시자 엑셀에는 접수 상태 열이 필요합니다.');
  }
  const lastColumn = toColumnName(columnCount);
  const lastDataRow = Math.max(HEADER_ROW, DATA_START_ROW + rows.length - 1);
  const autoFilterRef = `A${HEADER_ROW}:${lastColumn}${lastDataRow}`;
  const proofUrlColumn = columnCount;
  const generatedAtLabel = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(generatedAt);

  const data: SheetData = [
    [
      createTextCell('시험 응시자 명단', {
        columnSpan: columnCount,
        height: 34,
        fontSize: 18,
        fontWeight: 'bold',
        align: 'left',
        textColor: COLORS.white,
        backgroundColor: COLORS.orange,
        borderColor: COLORS.orange,
      }),
      ...Array.from({ length: columnCount - 1 }, () => null),
    ],
    [
      createTextCell(`다운로드 ${generatedAtLabel}  ·  총 ${rows.length.toLocaleString('ko-KR')}명`, {
        columnSpan: columnCount,
        height: 24,
        fontSize: 10,
        fontWeight: 'bold',
        align: 'left',
        textColor: COLORS.charcoal,
        backgroundColor: COLORS.orangeSoft,
      }),
      ...Array.from({ length: columnCount - 1 }, () => null),
    ],
    [
      createTextCell('입금 증빙 링크는 발급 시점부터 30일간 유효하며 전달 가능한 보안 링크입니다.', {
        columnSpan: columnCount,
        height: 22,
        fontSize: 9,
        align: 'left',
        textColor: COLORS.muted,
        backgroundColor: COLORS.white,
      }),
      ...Array.from({ length: columnCount - 1 }, () => null),
    ],
    headers.map((header) => createTextCell(header, {
      height: 32,
      fontSize: 10,
      fontWeight: 'bold',
      align: 'center',
      wrap: true,
      textColor: COLORS.white,
      backgroundColor: COLORS.charcoal,
      borderColor: COLORS.charcoal,
    })),
  ];

  const hyperlinkTargets: ExamApplicantWorkbookModel['hyperlinkTargets'] = [];

  rows.forEach((row, rowIndex) => {
    const sheetRowNumber = DATA_START_ROW + rowIndex;
    const backgroundColor = row.isConfirmed
      ? COLORS.orangeSoft
      : COLORS.pendingSoft;

    data.push(row.values.map((rawValue, columnIndex) => {
      const value = String(rawValue ?? '-');
      const isAddress = columnIndex === 3;
      const isProofPath = columnIndex === columnCount - 2;
      const isProofUrl = columnIndex === proofUrlColumn - 1;
      const isSubject = columnIndex === subjectColumnIndex;
      const isApplicationType = columnIndex === applicationTypeColumnIndex;
      const isReceptionStatus = columnIndex === receptionStatusColumnIndex;
      const isThirdExam = columnIndex === thirdExamColumnIndex;
      const proofUrl = isSafeHttpsUrl(row.proofUrl) ? row.proofUrl : null;

      if (isReceptionStatus) {
        return createTextCell(value, {
          height: 28,
          align: 'center',
          fontWeight: 'bold',
          textColor: COLORS.white,
          backgroundColor: row.isConfirmed ? COLORS.orange : COLORS.pending,
          borderColor: row.isConfirmed ? COLORS.orange : COLORS.pending,
        });
      }

      if (isProofUrl && proofUrl) {
        const relationshipId = `rId-exam-proof-${rowIndex + 1}`;
        hyperlinkTargets.push({
          cellRef: `${lastColumn}${sheetRowNumber}`,
          relationshipId,
          target: proofUrl,
        });
        return createTextCell('증빙 열기 (30일)', {
          height: 28,
          align: 'center',
          fontWeight: 'bold',
          textColor: COLORS.blue,
          textDecoration: { underline: true },
          backgroundColor,
        });
      }

      const highlighted = (
        (isApplicationType && value === '재신청')
        || (isThirdExam && value === '포함')
        || (isSubject && value.includes('제3보험'))
      );

      return createTextCell(value || '-', {
        height: isAddress ? 34 : 28,
        align: isAddress || isProofPath ? 'left' : 'center',
        wrap: isAddress || isProofPath,
        textColor: isProofPath ? COLORS.muted : COLORS.charcoal,
        fontSize: isProofPath ? 9 : 10,
        fontWeight: highlighted ? 'bold' : undefined,
        backgroundColor,
      });
    }));
  });

  const widths = [
    22, 14, 20, 44, 17, 16, 22, 18,
    16, 22, 18, 22, 18, 18, 18, 38, 24,
  ];
  const options: SheetOptions<Blob> = {
    sheet: '시험 응시자 명단',
    orientation: 'landscape',
    stickyRowsCount: HEADER_ROW,
    stickyColumnsCount: 2,
    showGridLines: false,
    zoomScale: 0.9,
    columns: headers.map((_, index) => ({
      width: widths[index] ?? 18,
    })),
  };
  const features = [
    createWorksheetEnhancementFeature({ autoFilterRef, hyperlinks: hyperlinkTargets }),
  ];

  return {
    data,
    options,
    features,
    hyperlinkTargets,
    autoFilterRef,
  };
}

export async function createExamApplicantWorkbookBlob(
  input: ExamApplicantWorkbookInput,
): Promise<Blob> {
  const model = buildExamApplicantWorkbookModel(input);
  return writeExcelFile(
    model.data,
    model.options,
    { features: model.features },
  ).toBlob();
}

export async function downloadExamApplicantWorkbook(
  input: ExamApplicantWorkbookInput & { fileName: string },
): Promise<void> {
  const blob = await createExamApplicantWorkbookBlob(input);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = input.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

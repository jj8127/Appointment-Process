/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  expectedMessengerAttachmentMimeType,
  inspectMessengerAttachment,
  MESSENGER_ATTACHMENT_ALLOWED_MIME_TYPES,
  MESSENGER_ATTACHMENT_MAX_BYTES,
  MESSENGER_ATTACHMENT_MAX_FILES,
  normalizeMessengerAttachmentFileDescriptors,
  normalizeMessengerAttachmentFilename,
  normalizeMessengerAttachmentIntentIds,
  normalizeMessengerAttachmentSha256,
  normalizeMessengerAttachmentUuid,
} from "../messenger-attachment-policy.ts";

const encoder = new TextEncoder();
const SHA256_A = "a".repeat(64);
const UUIDS = Array.from(
  { length: 11 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
} as const;

type OoxmlFamily = "docx" | "xlsx" | "pptx";
type LegacyOfficeFamily = "doc" | "xls" | "ppt";

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(
  entries: Array<{ name: string; content: Uint8Array }>,
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.content);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.content.length, true);
    localView.setUint32(22, entry.content.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, entry.content);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.content.length, true);
    centralView.setUint32(24, entry.content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + entry.content.length;
  }

  const locals = concat(localParts);
  const central = concat(centralParts);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, locals.length, true);
  return concat([locals, central, eocd]);
}

const OOXML_SPEC = {
  docx: {
    mainPart: "word/document.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    root: "w:document",
    namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    root: "x:workbook",
    namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    root: "p:presentation",
    namespace: "http://schemas.openxmlformats.org/presentationml/2006/main",
  },
} as const;

function buildOoxml(
  family: OoxmlFamily,
  options: {
    externalRelationship?: boolean;
    extraEntries?: Array<{ name: string; content: Uint8Array }>;
    extraContentType?: string;
    nestedExternalRelationship?: {
      entryName: string;
      type: string;
      target: string;
    };
  } = {},
): Uint8Array {
  const spec = OOXML_SPEC[family];
  const contentTypeRows = [
    `<Override PartName="/${spec.mainPart}" ContentType="${spec.contentType}"/>`,
    options.extraContentType
      ? `<Override PartName="/word/vbaProject.bin" ContentType="${options.extraContentType}"/>`
      : "",
  ].join("");
  const contentTypes = encoder.encode(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypeRows}</Types>`,
  );
  const relationship = encoder.encode(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      `Target="${spec.mainPart}"${
        options.externalRelationship ? ' TargetMode="External"' : ""
      }/>` +
      "</Relationships>",
  );
  const prefix = spec.root.split(":")[0];
  const mainPart = encoder.encode(
    `<${spec.root} xmlns:${prefix}="${spec.namespace}"></${spec.root}>`,
  );
  const nestedExternalRelationship = options.nestedExternalRelationship
    ? [{
      name: options.nestedExternalRelationship.entryName,
      content: encoder.encode(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdExternal" ' +
          `Type="${options.nestedExternalRelationship.type}" ` +
          `Target="${options.nestedExternalRelationship.target}" TargetMode="External"/>` +
          "</Relationships>",
      ),
    }]
    : [];
  return buildStoredZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: relationship },
    { name: spec.mainPart, content: mainPart },
    ...nestedExternalRelationship,
    ...(options.extraEntries ?? []),
  ]);
}

const CFB_FREESECT = 0xffffffff;
const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_FATSECT = 0xfffffffd;

function writeCfbDirectoryEntry(input: {
  directory: Uint8Array;
  index: number;
  name: string;
  type: 1 | 2 | 5;
  startSector?: number;
  size?: number;
}) {
  const offset = input.index * 128;
  const raw = input.directory.subarray(offset, offset + 128);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const encodedName = encoder.encode(`${input.name}\0`);
  const utf16 = new Uint8Array((input.name.length + 1) * 2);
  for (let index = 0; index < input.name.length; index += 1) {
    new DataView(utf16.buffer).setUint16(
      index * 2,
      input.name.charCodeAt(index),
      true,
    );
  }
  raw.set(utf16, 0);
  view.setUint16(64, encodedName.length * 2, true);
  raw[66] = input.type;
  view.setUint32(68, CFB_FREESECT, true);
  view.setUint32(72, CFB_FREESECT, true);
  view.setUint32(76, CFB_FREESECT, true);
  view.setUint32(116, input.startSector ?? CFB_ENDOFCHAIN, true);
  view.setBigUint64(120, BigInt(input.size ?? 0), true);
}

function buildLegacyOffice(
  family: LegacyOfficeFamily,
  extraDirectoryNames: string[] = [],
): Uint8Array {
  const sectorSize = 512;
  const header = new Uint8Array(sectorSize);
  const headerView = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  headerView.setUint16(24, 0x003e, true);
  headerView.setUint16(26, 3, true);
  headerView.setUint16(28, 0xfffe, true);
  headerView.setUint16(30, 9, true);
  headerView.setUint16(32, 6, true);
  headerView.setUint32(40, 0, true);
  headerView.setUint32(44, 1, true);
  headerView.setUint32(48, 1, true);
  headerView.setUint32(56, 4096, true);
  headerView.setUint32(60, 2, true);
  headerView.setUint32(64, 1, true);
  headerView.setUint32(68, CFB_ENDOFCHAIN, true);
  headerView.setUint32(72, 0, true);
  for (let index = 0; index < 109; index += 1) {
    headerView.setUint32(76 + index * 4, index === 0 ? 0 : CFB_FREESECT, true);
  }

  const fat = new Uint8Array(sectorSize);
  const fatView = new DataView(fat.buffer);
  for (let index = 0; index < sectorSize / 4; index += 1) {
    fatView.setUint32(index * 4, CFB_FREESECT, true);
  }
  fatView.setUint32(0, CFB_FATSECT, true);
  fatView.setUint32(4, CFB_ENDOFCHAIN, true);
  fatView.setUint32(8, CFB_ENDOFCHAIN, true);
  fatView.setUint32(12, CFB_ENDOFCHAIN, true);

  const directory = new Uint8Array(sectorSize);
  const streamName = family === "doc"
    ? "WordDocument"
    : family === "xls"
    ? "Workbook"
    : "PowerPoint Document";
  writeCfbDirectoryEntry({
    directory,
    index: 0,
    name: "Root Entry",
    type: 5,
    startSector: 3,
    size: sectorSize,
  });
  writeCfbDirectoryEntry({
    directory,
    index: 1,
    name: streamName,
    type: 2,
    startSector: 0,
    size: 32,
  });
  extraDirectoryNames.slice(0, 2).forEach((name, index) => {
    writeCfbDirectoryEntry({ directory, index: index + 2, name, type: 1 });
  });

  const miniFat = new Uint8Array(sectorSize);
  const miniFatView = new DataView(miniFat.buffer);
  for (let index = 0; index < sectorSize / 4; index += 1) {
    miniFatView.setUint32(
      index * 4,
      index === 0 ? CFB_ENDOFCHAIN : CFB_FREESECT,
      true,
    );
  }

  const miniStream = new Uint8Array(sectorSize);
  const streamView = new DataView(miniStream.buffer);
  if (family === "doc") {
    streamView.setUint16(0, 0xa5ec, true);
    streamView.setUint16(2, 0x00c1, true);
    streamView.setUint32(24, 0, true);
    streamView.setUint32(28, 0, true);
  } else if (family === "xls") {
    streamView.setUint16(0, 0x0809, true);
    streamView.setUint16(2, 4, true);
    streamView.setUint16(4, 0x0600, true);
    streamView.setUint16(6, 0x0005, true);
  } else {
    streamView.setUint16(0, 0x000f, true);
    streamView.setUint16(2, 0x03e8, true);
    streamView.setUint32(4, 0, true);
  }
  return concat([header, fat, directory, miniFat, miniStream]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function inspect(name: string, bytes: Uint8Array) {
  return await inspectMessengerAttachment({
    name,
    declaredMimeType: expectedMessengerAttachmentMimeType(name)!,
    expectedSize: bytes.length,
    expectedSha256: await sha256Hex(bytes),
    bytes,
  });
}

async function assertInspectionRejects(
  name: string,
  bytes: Uint8Array,
  expectedMessage: string,
) {
  await assertRejects(
    () => inspect(name, bytes),
    Error,
    expectedMessage,
  );
}

Deno.test("attachment allowlist is exact and includes TXT plus all approved Office/image types", () => {
  assertEquals(
    new Set(MESSENGER_ATTACHMENT_ALLOWED_MIME_TYPES),
    new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/bmp",
      "image/heic",
      "image/heif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ]),
  );
  for (const [extension, mime] of Object.entries(MIME_BY_EXTENSION)) {
    assertEquals(
      expectedMessengerAttachmentMimeType(`보고서.${extension.toUpperCase()}`),
      mime,
    );
  }
  assertEquals(expectedMessengerAttachmentMimeType("archive.zip"), null);
  assertEquals(expectedMessengerAttachmentMimeType("document.hwp"), null);
  assertEquals(expectedMessengerAttachmentMimeType("program.exe"), null);
});

Deno.test("descriptor policy enforces NFC names, UUID/hash normalization, 20 MiB and 10 files", () => {
  assertEquals(MESSENGER_ATTACHMENT_MAX_BYTES, 20 * 1024 * 1024);
  assertEquals(MESSENGER_ATTACHMENT_MAX_FILES, 10);
  assertEquals(normalizeMessengerAttachmentFilename(" 가람.txt "), "가람.txt");
  assertEquals(
    normalizeMessengerAttachmentUuid(UUIDS[0]!.toUpperCase()),
    UUIDS[0],
  );
  assertEquals(
    normalizeMessengerAttachmentSha256(SHA256_A.toUpperCase()),
    SHA256_A,
  );

  const descriptors = UUIDS.slice(0, 10).map((clientFileId, index) => ({
    clientFileId,
    name: index === 0 ? "가람.txt" : `file-${index}.txt`,
    size: index === 0 ? MESSENGER_ATTACHMENT_MAX_BYTES : 1,
    mimeType: "TEXT/PLAIN",
    sha256: SHA256_A.toUpperCase(),
  }));
  const normalized = normalizeMessengerAttachmentFileDescriptors(descriptors);
  assertEquals(normalized?.length, 10);
  assertEquals(normalized?.[0]?.name, "가람.txt");
  assertEquals(normalized?.[0]?.size, MESSENGER_ATTACHMENT_MAX_BYTES);

  assertEquals(normalizeMessengerAttachmentFileDescriptors([]), null);
  assertEquals(
    normalizeMessengerAttachmentFileDescriptors([
      ...descriptors,
      { ...descriptors[0], clientFileId: UUIDS[10] },
    ]),
    null,
  );
  assertEquals(
    normalizeMessengerAttachmentFileDescriptors([
      { ...descriptors[0], size: MESSENGER_ATTACHMENT_MAX_BYTES + 1 },
    ]),
    null,
  );
  assertEquals(
    normalizeMessengerAttachmentFileDescriptors([
      descriptors[0],
      { ...descriptors[1], clientFileId: descriptors[0].clientFileId },
    ]),
    null,
  );
  assertEquals(
    normalizeMessengerAttachmentFileDescriptors([
      { ...descriptors[0], mimeType: "application/octet-stream" },
    ]),
    null,
  );
  assertEquals(
    normalizeMessengerAttachmentIntentIds(UUIDS.slice(0, 10)),
    UUIDS.slice(0, 10),
  );
  assertEquals(normalizeMessengerAttachmentIntentIds(UUIDS), null);
  assertEquals(
    normalizeMessengerAttachmentIntentIds([UUIDS[0], UUIDS[0]]),
    null,
  );
});

Deno.test("filename and identifier policy rejects traversal, controls and malformed values", () => {
  for (
    const invalidName of [
      "../report.txt",
      "..\\report.txt",
      "folder/report.txt",
      "folder\\report.txt",
      "bad\u0000name.txt",
      ".",
      "..",
      "a".repeat(256),
    ]
  ) {
    assertEquals(normalizeMessengerAttachmentFilename(invalidName), null);
  }
  assertEquals(normalizeMessengerAttachmentUuid("not-a-uuid"), null);
  assertEquals(
    normalizeMessengerAttachmentUuid("00000000-0000-0000-0000-000000000000"),
    null,
  );
  assertEquals(normalizeMessengerAttachmentSha256("f".repeat(63)), null);
});

Deno.test("simple image, PDF and TXT signatures pass only for their declared family", async () => {
  const fixtures: Array<[string, Uint8Array, string]> = [
    ["photo.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), "jpeg"],
    [
      "photo.jpeg",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0]),
      "jpeg",
    ],
    [
      "photo.png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "png",
    ],
    [
      "photo.webp",
      concat([
        encoder.encode("RIFF"),
        new Uint8Array(4),
        encoder.encode("WEBP"),
      ]),
      "webp",
    ],
    ["photo.gif", encoder.encode("GIF89a"), "gif"],
    ["photo.bmp", new Uint8Array([0x42, 0x4d, 0, 0, 0, 0]), "bmp"],
    [
      "photo.heic",
      concat([new Uint8Array([0, 0, 0, 20]), encoder.encode("ftypheic")]),
      "heic",
    ],
    [
      "photo.heif",
      concat([new Uint8Array([0, 0, 0, 20]), encoder.encode("ftypmif1")]),
      "heif",
    ],
    [
      "safe.pdf",
      encoder.encode(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF",
      ),
      "pdf",
    ],
    ["notes.txt", encoder.encode("한글 메모\r\nplain text"), "txt"],
  ];
  for (const [name, bytes, family] of fixtures) {
    const result = await inspect(name, bytes);
    assertEquals(result.family, family);
    assertEquals(result.size, bytes.length);
    assertEquals(result.mimeType, expectedMessengerAttachmentMimeType(name));
  }

  await assertInspectionRejects(
    "photo.jpg",
    fixtures[2]![1],
    "invalid_attachment_content",
  );
});

Deno.test("DOC/DOCX/XLS/XLSX/PPT/PPTX byte structures are independently verified", async () => {
  for (const family of ["doc", "xls", "ppt"] as const) {
    const bytes = buildLegacyOffice(family);
    const result = await inspect(`office.${family}`, bytes);
    assertEquals(result.family, family);
  }
  for (const family of ["docx", "xlsx", "pptx"] as const) {
    const bytes = buildOoxml(family);
    const result = await inspect(`office.${family}`, bytes);
    assertEquals(result.family, family);
  }

  await assertInspectionRejects(
    "renamed.doc",
    buildLegacyOffice("xls"),
    "invalid_attachment_content",
  );
  await assertInspectionRejects(
    "renamed.docx",
    buildOoxml("xlsx"),
    "attachment_ooxml_required_part_missing",
  );
});

Deno.test("active content and polyglots are rejected across PDF, OOXML, CFB, images and TXT", async () => {
  await assertInspectionRejects(
    "active.pdf",
    encoder.encode(
      "%PDF-1.7\n1 0 obj\n<< /S /JavaScript /JS(alert) >>\nendobj\n%%EOF",
    ),
    "attachment_pdf_active_content_rejected",
  );
  await assertInspectionRejects(
    "embedded.pdf",
    concat([
      encoder.encode("%PDF-1.7\n%%EOF\n"),
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    ]),
    "attachment_pdf_embedded_content_rejected",
  );
  await assertInspectionRejects(
    "macro.docx",
    buildOoxml("docx", {
      extraContentType: "application/vnd.ms-office.vbaProject",
    }),
    "attachment_ooxml_macro_rejected",
  );
  await assertInspectionRejects(
    "external.xlsx",
    buildOoxml("xlsx", { externalRelationship: true }),
    "attachment_ooxml_external_relationship_rejected",
  );
  await assertInspectionRejects(
    "embedded.pptx",
    buildOoxml("pptx", {
      extraEntries: [{
        name: "ppt/embeddings/embedded.bin",
        content: encoder.encode("not allowed"),
      }],
    }),
    "attachment_ooxml_embedded_content_rejected",
  );
  await assertInspectionRejects(
    "hwp-disguised.doc",
    buildLegacyOffice("doc", ["FileHeader"]),
    "attachment_cfb_hwp_rejected",
  );
  await assertInspectionRejects(
    "macro.xls",
    buildLegacyOffice("xls", ["VBA"]),
    "attachment_cfb_macro_rejected",
  );
  await assertInspectionRejects(
    "embedded.ppt",
    buildLegacyOffice("ppt", ["ObjectPool"]),
    "attachment_cfb_embedded_object_rejected",
  );
  await assertInspectionRejects(
    "polyglot.png",
    concat([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    ]),
    "invalid_attachment_polyglot",
  );
  await assertInspectionRejects(
    "binary.txt",
    new Uint8Array([0x68, 0x69, 0x00, 0x21]),
    "invalid_attachment_content",
  );
  await assertInspectionRejects(
    "archive.txt",
    concat([encoder.encode("plain"), new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
    "invalid_attachment_content",
  );
});

Deno.test("nested external OOXML relationships are rejected for DOCX, XLSX and PPTX", async () => {
  const fixtures = [
    {
      name: "nested-external.docx",
      bytes: buildOoxml("docx", {
        nestedExternalRelationship: {
          entryName: "word/_rels/document.xml.rels",
          type:
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
          target: "https://example.invalid/document",
        },
      }),
    },
    {
      name: "nested-external.xlsx",
      bytes: buildOoxml("xlsx", {
        nestedExternalRelationship: {
          entryName: "xl/_rels/workbook.xml.rels",
          type:
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath",
          target: "file://fileserver.invalid/share/source.xlsx",
        },
      }),
    },
    {
      name: "nested-external.pptx",
      bytes: buildOoxml("pptx", {
        nestedExternalRelationship: {
          entryName: "ppt/_rels/presentation.xml.rels",
          type:
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
          target: "http://example.invalid/presentation",
        },
      }),
    },
  ];

  for (const fixture of fixtures) {
    await assertInspectionRejects(
      fixture.name,
      fixture.bytes,
      "attachment_ooxml_external_relationship_rejected",
    );
  }
});

Deno.test("inspection enforces hash, declared MIME and exact 20 MiB byte boundary", async () => {
  const bytes = encoder.encode("boundary");
  await assertRejects(
    () =>
      inspectMessengerAttachment({
        name: "boundary.txt",
        declaredMimeType: "application/octet-stream",
        expectedSize: bytes.length,
        expectedSha256: SHA256_A,
        bytes,
      }),
    Error,
    "invalid_attachment_mime",
  );
  await assertRejects(
    () =>
      inspectMessengerAttachment({
        name: "boundary.txt",
        declaredMimeType: "text/plain",
        expectedSize: bytes.length,
        expectedSha256: SHA256_A,
        bytes,
      }),
    Error,
    "invalid_attachment_hash",
  );

  const maximum = new Uint8Array(MESSENGER_ATTACHMENT_MAX_BYTES).fill(0x61);
  const accepted = await inspect("maximum.txt", maximum);
  assertEquals(accepted.size, MESSENGER_ATTACHMENT_MAX_BYTES);
  await assertRejects(
    () =>
      inspectMessengerAttachment({
        name: "too-large.txt",
        declaredMimeType: "text/plain",
        expectedSize: MESSENGER_ATTACHMENT_MAX_BYTES + 1,
        expectedSha256: SHA256_A,
        bytes: new Uint8Array(MESSENGER_ATTACHMENT_MAX_BYTES + 1).fill(0x61),
      }),
    Error,
    "invalid_attachment_size",
  );
});

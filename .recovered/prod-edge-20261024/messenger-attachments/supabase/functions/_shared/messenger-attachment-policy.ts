import { XMLParser, XMLValidator } from 'npm:fast-xml-parser@5.10.1';

export const MESSENGER_ATTACHMENT_BUCKET = 'messenger-attachments-v2';
export const MESSENGER_ATTACHMENT_MAX_FILES = 10;
export const MESSENGER_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const MESSENGER_ATTACHMENT_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
export const MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS = 5 * 60;

const EXTENSION_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
} as const;

export const MESSENGER_ATTACHMENT_ALLOWED_MIME_TYPES = Array.from(
  new Set(Object.values(EXTENSION_MIME)),
);

export type MessengerAttachmentExtension = keyof typeof EXTENSION_MIME;
export type MessengerAttachmentFamily =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'heic'
  | 'heif'
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'ppt'
  | 'pptx'
  | 'txt';

export type MessengerAttachmentContext =
  | { kind: 'direct'; conversationId: string }
  | { kind: 'group'; roomId: string }
  | { kind: 'direct_broadcast'; conversationIds: string[] };

export type MessengerAttachmentFileDescriptor = {
  clientFileId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
};

export type InspectedMessengerAttachment = {
  extension: MessengerAttachmentExtension;
  mimeType: string;
  family: MessengerAttachmentFamily;
  sha256: string;
  size: number;
};

const EXPECTED_FAMILY: Record<MessengerAttachmentExtension, MessengerAttachmentFamily> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
  '.bmp': 'bmp',
  '.heic': 'heic',
  '.heif': 'heif',
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.xls': 'xls',
  '.xlsx': 'xlsx',
  '.ppt': 'ppt',
  '.pptx': 'pptx',
  '.txt': 'txt',
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_FILENAME_PATTERN = /^[^\u0000-\u001f\u007f/\\]+$/u;

export function normalizeMessengerAttachmentUuid(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeMessengerAttachmentSha256(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeMessengerAttachmentFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (
    normalized.length < 1
    || normalized.length > 255
    || !SAFE_FILENAME_PATTERN.test(normalized)
    || normalized === '.'
    || normalized === '..'
  ) {
    return null;
  }
  return normalized;
}

function extensionOf(fileName: string): MessengerAttachmentExtension | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  const extension = fileName.slice(dot).toLowerCase() as MessengerAttachmentExtension;
  return extension in EXTENSION_MIME ? extension : null;
}

export function expectedMessengerAttachmentMimeType(
  fileName: string,
): string | null {
  const normalizedName = normalizeMessengerAttachmentFilename(fileName);
  if (!normalizedName) return null;
  const extension = extensionOf(normalizedName);
  return extension ? EXTENSION_MIME[extension] : null;
}

export function normalizeMessengerAttachmentFileDescriptors(
  value: unknown,
): MessengerAttachmentFileDescriptor[] | null {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > MESSENGER_ATTACHMENT_MAX_FILES
  ) {
    return null;
  }

  const descriptors: MessengerAttachmentFileDescriptor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const clientFileId = normalizeMessengerAttachmentUuid(record.clientFileId);
    const name = normalizeMessengerAttachmentFilename(record.name);
    const size = Number(record.size);
    const mimeType = typeof record.mimeType === 'string'
      ? record.mimeType.trim().toLowerCase()
      : '';
    const sha256 = normalizeMessengerAttachmentSha256(record.sha256);
    if (
      !clientFileId
      || !name
      || !Number.isSafeInteger(size)
      || size < 1
      || size > MESSENGER_ATTACHMENT_MAX_BYTES
      || !sha256
      || expectedMessengerAttachmentMimeType(name) !== mimeType
    ) {
      return null;
    }
    descriptors.push({ clientFileId, name, size, mimeType, sha256 });
  }

  if (new Set(descriptors.map((descriptor) => descriptor.clientFileId)).size !== descriptors.length) {
    return null;
  }
  return descriptors;
}

export function normalizeMessengerAttachmentIntentIds(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MESSENGER_ATTACHMENT_MAX_FILES) return null;
  const ids = value.map(normalizeMessengerAttachmentUuid);
  if (ids.some((id) => !id)) return null;
  const normalized = ids as string[];
  return new Set(normalized).size === normalized.length ? normalized : null;
}

const byteAt = (bytes: Uint8Array, offset: number) => bytes[offset] ?? -1;
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => byteAt(bytes, offset + index) === value);
const ascii = (bytes: Uint8Array, start = 0, end = bytes.length) =>
  new TextDecoder('latin1').decode(bytes.subarray(start, end));

function hasPlausibleEmbeddedExecutable(bytes: Uint8Array): boolean {
  for (let offset = 0; offset + 64 <= bytes.length; offset += 1) {
    if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46], offset)) return true;
    if (startsWith(bytes, [0x23, 0x21], offset)) return true;
    if (!startsWith(bytes, [0x4d, 0x5a], offset)) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
    const peOffset = view.getUint32(0x3c, true);
    if (
      peOffset >= 0x40
      && peOffset + 4 <= view.byteLength
      && view.getUint32(peOffset, true) === 0x00004550
    ) {
      return true;
    }
  }
  return false;
}

function hasEmbeddedZip(bytes: Uint8Array, allowAtStart = false): boolean {
  const start = allowAtStart ? 1 : 0;
  for (let offset = start; offset + 4 <= bytes.length; offset += 1) {
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04], offset)) return true;
  }
  return false;
}

function isStrictUtf8PlainText(bytes: Uint8Array): boolean {
  if (bytes.length < 1 || bytes.includes(0)) return false;
  let controls = 0;
  for (const value of bytes) {
    if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) {
      controls += 1;
    }
  }
  if (controls / bytes.length > 0.01) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !hasPlausibleEmbeddedExecutable(bytes) && !hasEmbeddedZip(bytes);
  } catch {
    return false;
  }
}

type ZipEntry = {
  name: string;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_EOCD_MAX_SEARCH = 65_557;
const ZIP_MAX_ENTRIES = 4096;
const ZIP_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_RATIO = 100;

function findZipEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - ZIP_EOCD_MAX_SEARCH);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - ZIP_EOCD_MIN_BYTES; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === bytes.length) return offset;
  }
  throw new Error('attachment_zip_eocd_invalid');
}

function decodeZipEntryName(raw: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new Error('attachment_zip_name_invalid');
  }
  if (
    !decoded
    || decoded.includes('\0')
    || decoded.includes('\\')
    || decoded.startsWith('/')
    || /^[a-z]:/i.test(decoded)
  ) {
    throw new Error('attachment_zip_path_invalid');
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error('attachment_zip_path_invalid');
  }
  return decoded;
}

function parseZipDirectory(bytes: Uint8Array): ZipEntry[] {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new Error('attachment_zip_prefix_invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findZipEocd(bytes);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    disk !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entryCount
    || entryCount < 1
    || entryCount > ZIP_MAX_ENTRIES
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || centralOffset + centralSize !== eocd
  ) {
    throw new Error('attachment_zip_bounds_invalid');
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('attachment_zip_directory_invalid');
    }
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (
      end > eocd
      || (flags & 0x0001) !== 0
      || (flags & 0x0008) !== 0
      || ![0, 8].includes(compressionMethod)
      || diskStart !== 0
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || uncompressedSize > ZIP_MAX_ENTRY_BYTES
    ) {
      throw new Error('attachment_zip_entry_unsafe');
    }
    for (let extraOffset = offset + 46 + nameLength; extraOffset + 4 <= offset + 46 + nameLength + extraLength;) {
      const id = view.getUint16(extraOffset, true);
      const length = view.getUint16(extraOffset + 2, true);
      if (extraOffset + 4 + length > offset + 46 + nameLength + extraLength) {
        throw new Error('attachment_zip_extra_invalid');
      }
      if (id === 0x0001) throw new Error('attachment_zip64_unsupported');
      extraOffset += 4 + length;
    }
    const ratio = compressedSize === 0
      ? (uncompressedSize === 0 ? 1 : Number.POSITIVE_INFINITY)
      : uncompressedSize / compressedSize;
    if (ratio > ZIP_MAX_RATIO) throw new Error('attachment_zip_ratio_exceeded');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > ZIP_MAX_TOTAL_BYTES) {
      throw new Error('attachment_zip_total_exceeded');
    }
    const name = decodeZipEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (names.has(name)) throw new Error('attachment_zip_duplicate_entry');
    names.add(name);
    entries.push({
      name,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== eocd) throw new Error('attachment_zip_directory_invalid');
  return entries;
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

async function inflateRawBounded(
  compressed: Uint8Array,
  expectedSize: number,
): Promise<Uint8Array> {
  const stream = new Blob([compressed.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.length;
    if (total > expectedSize || total > ZIP_MAX_ENTRY_BYTES) {
      await reader.cancel();
      throw new Error('attachment_zip_inflated_size_invalid');
    }
    chunks.push(result.value);
  }
  if (total !== expectedSize) throw new Error('attachment_zip_inflated_size_invalid');
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('attachment_zip_local_header_invalid');
  }
  const flags = view.getUint16(offset + 6, true);
  const method = view.getUint16(offset + 8, true);
  const crc = view.getUint32(offset + 14, true);
  const compressedSize = view.getUint32(offset + 18, true);
  const uncompressedSize = view.getUint32(offset + 22, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + compressedSize;
  if (
    dataEnd > bytes.length
    || flags !== 0x0800 && flags !== 0
    || method !== entry.compressionMethod
    || crc !== entry.crc32
    || compressedSize !== entry.compressedSize
    || uncompressedSize !== entry.uncompressedSize
  ) {
    throw new Error('attachment_zip_local_header_mismatch');
  }
  const localName = decodeZipEntryName(bytes.subarray(offset + 30, offset + 30 + nameLength));
  if (localName !== entry.name) throw new Error('attachment_zip_local_name_mismatch');
  const compressed = bytes.subarray(dataOffset, dataEnd);
  const output = method === 0
    ? new Uint8Array(compressed)
    : await inflateRawBounded(compressed, uncompressedSize);
  if (output.length !== uncompressedSize || crc32(output) !== entry.crc32) {
    throw new Error('attachment_zip_crc_mismatch');
  }
  return output;
}

type OoxmlFamily = 'docx' | 'xlsx' | 'pptx';
const OOXML_SPEC: Record<OoxmlFamily, {
  mainPart: string;
  contentType: string;
  rootLocalName: string;
  rootNamespace: string;
}> = {
  docx: {
    mainPart: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    rootLocalName: 'document',
    rootNamespace: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  },
  xlsx: {
    mainPart: 'xl/workbook.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    rootLocalName: 'workbook',
    rootNamespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  },
  pptx: {
    mainPart: 'ppt/presentation.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    rootLocalName: 'presentation',
    rootNamespace: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  },
};

function assertSafeZipPartName(name: string) {
  const lower = name.toLowerCase();
  const pathParts = lower.split('/');
  const basename = pathParts[pathParts.length - 1] ?? '';
  if (
    /\.(?:exe|dll|com|bat|cmd|msi|ps1|js|jse|vbs|vbe|scr|jar|apk|dmg|sh)$/i.test(basename)
    || basename === 'vbaproject.bin'
    || lower.includes('/embeddings/')
    || lower.includes('/activex/')
  ) {
    throw new Error('attachment_ooxml_embedded_content_rejected');
  }
}

function parseBoundedXml(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.length < 1 || bytes.length > 1024 * 1024) {
    throw new Error('attachment_ooxml_xml_bounds');
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('attachment_ooxml_xml_invalid');
  }
  if (
    XMLValidator.validate(xml) !== true
    || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)
  ) {
    throw new Error('attachment_ooxml_xml_invalid');
  }
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    htmlEntities: false,
    maxNestedTags: 64,
    strictReservedNames: true,
    removeNSPrefix: false,
  }).parse(xml) as Record<string, unknown>;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function findRootByLocalName(
  document: Record<string, unknown>,
  localName: string,
): Record<string, unknown> | null {
  for (const [name, value] of Object.entries(document)) {
    const nameParts = name.split(':');
    if (
      nameParts[nameParts.length - 1] === localName
      && value
      && typeof value === 'object'
      && !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

const OOXML_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';

function findChildrenByLocalName(
  node: Record<string, unknown>,
  localName: string,
): unknown[] {
  const children: unknown[] = [];
  for (const [name, value] of Object.entries(node)) {
    const nameParts = name.split(':');
    if (nameParts[nameParts.length - 1] === localName) {
      children.push(...asArray(value));
    }
  }
  return children;
}

function inspectOoxmlRelationshipsPart(
  bytes: Uint8Array,
): Record<string, unknown>[] {
  const relationships = parseBoundedXml(bytes);
  const root = findRootByLocalName(relationships, 'Relationships');
  if (
    !root
    || !Object.entries(root).some(([name, value]) =>
      (name === '@_xmlns' || name.startsWith('@_xmlns:'))
      && value === OOXML_RELATIONSHIPS_NAMESPACE
    )
  ) {
    throw new Error('attachment_ooxml_relationship_mismatch');
  }

  const rawRows = findChildrenByLocalName(root, 'Relationship');
  if (rawRows.some((row) =>
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
  )) {
    throw new Error('attachment_ooxml_relationship_mismatch');
  }
  const rows = rawRows as Record<string, unknown>[];
  if (rows.some((row) =>
    typeof row['@_Id'] !== 'string'
    || typeof row['@_Type'] !== 'string'
    || typeof row['@_Target'] !== 'string'
  )) {
    throw new Error('attachment_ooxml_relationship_mismatch');
  }
  if (rows.some((row) =>
    String(row['@_TargetMode'] ?? '').trim().toLowerCase() === 'external'
  )) {
    throw new Error('attachment_ooxml_external_relationship_rejected');
  }
  return rows;
}

async function inspectOoxml(
  bytes: Uint8Array,
  expected: OoxmlFamily,
): Promise<OoxmlFamily> {
  const entries = parseZipDirectory(bytes);
  const spec = OOXML_SPEC[expected];
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const required of ['[Content_Types].xml', '_rels/.rels', spec.mainPart]) {
    if (!byName.has(required)) throw new Error('attachment_ooxml_required_part_missing');
  }

  const contents = new Map<string, Uint8Array>();
  for (const entry of entries) {
    assertSafeZipPartName(entry.name);
    if (entry.name.endsWith('/')) continue;
    const content = await readZipEntry(bytes, entry);
    if (hasPlausibleEmbeddedExecutable(content)) {
      throw new Error('attachment_ooxml_executable_content_rejected');
    }
    contents.set(entry.name, content);
  }

  const relationshipsByPart = new Map<string, Record<string, unknown>[]>();
  for (const [name, content] of contents) {
    if (name.toLowerCase().endsWith('.rels')) {
      relationshipsByPart.set(name, inspectOoxmlRelationshipsPart(content));
    }
  }

  const contentTypes = parseBoundedXml(contents.get('[Content_Types].xml')!);
  const typesRoot = findRootByLocalName(contentTypes, 'Types');
  const overrideRows = asArray(
    typesRoot?.Override as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );
  if (!overrideRows.some((row) =>
    row?.['@_PartName'] === `/${spec.mainPart}`
    && row?.['@_ContentType'] === spec.contentType
  )) {
    throw new Error('attachment_ooxml_content_type_mismatch');
  }
  if (overrideRows.some((row) =>
    typeof row?.['@_ContentType'] === 'string'
    && /macroEnabled|vbaProject|activeX|oleObject/i.test(String(row['@_ContentType']))
  )) {
    throw new Error('attachment_ooxml_macro_rejected');
  }

  const relationshipRows = relationshipsByPart.get('_rels/.rels') ?? [];
  const officeRelationship =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  if (!relationshipRows.some((row) =>
    row?.['@_Type'] === officeRelationship
    && String(row?.['@_Target'] ?? '').replace(/^\/+/, '') === spec.mainPart
  )) {
    throw new Error('attachment_ooxml_relationship_mismatch');
  }

  const mainPart = parseBoundedXml(contents.get(spec.mainPart)!);
  const root = findRootByLocalName(mainPart, spec.rootLocalName);
  const namespace = Object.entries(root ?? {}).find(([key]) =>
    key === '@_xmlns' || key.startsWith('@_xmlns:')
  )?.[1];
  if (!root || namespace !== spec.rootNamespace) {
    throw new Error('attachment_ooxml_main_part_mismatch');
  }
  return expected;
}

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CFB_FREESECT = 0xffffffff;
const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_FATSECT = 0xfffffffd;
const CFB_DIFSECT = 0xfffffffc;
const CFB_MAX_CHAIN = 131_072;
const CFB_MAX_DIRECTORY_ENTRIES = 16_384;

type CfbEntry = {
  name: string;
  type: number;
  startSector: number;
  size: number;
};

function cfbSector(bytes: Uint8Array, sectorSize: number, sectorId: number): Uint8Array {
  const offset = (sectorId + 1) * sectorSize;
  if (
    !Number.isInteger(sectorId)
    || sectorId < 0
    || offset < sectorSize
    || offset + sectorSize > bytes.length
  ) {
    throw new Error('attachment_cfb_sector_invalid');
  }
  return bytes.subarray(offset, offset + sectorSize);
}

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function cfbChain(start: number, fat: number[], limit: number): number[] {
  if (start === CFB_ENDOFCHAIN) return [];
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = start;
  while (current !== CFB_ENDOFCHAIN) {
    if (
      current === CFB_FREESECT
      || current === CFB_FATSECT
      || current === CFB_DIFSECT
      || current >= fat.length
      || seen.has(current)
      || chain.length >= limit
    ) {
      throw new Error('attachment_cfb_chain_invalid');
    }
    seen.add(current);
    chain.push(current);
    current = fat[current]!;
  }
  return chain;
}

function concatBytes(parts: Uint8Array[], limit = Number.MAX_SAFE_INTEGER): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total > limit) throw new Error('attachment_container_bounds');
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function decodeCfbName(raw: Uint8Array): string {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nameLength = view.getUint16(64, true);
  if (
    nameLength < 2
    || nameLength > 64
    || nameLength % 2 !== 0
    || raw[nameLength - 2] !== 0
    || raw[nameLength - 1] !== 0
  ) {
    throw new Error('attachment_cfb_name_invalid');
  }
  return new TextDecoder('utf-16le', { fatal: true })
    .decode(raw.subarray(0, nameLength - 2))
    .normalize('NFC');
}

function readCfbStream(
  bytes: Uint8Array,
  sectorSize: number,
  fat: number[],
  miniFat: number[],
  miniStream: Uint8Array,
  entry: CfbEntry,
): Uint8Array {
  if (entry.size === 0) return new Uint8Array();
  if (entry.size > MESSENGER_ATTACHMENT_MAX_BYTES) {
    throw new Error('attachment_cfb_stream_bounds');
  }
  if (entry.size < 4096) {
    const chain = cfbChain(entry.startSector, miniFat, Math.ceil(entry.size / 64) + 1);
    const parts = chain.map((sectorId) => {
      const offset = sectorId * 64;
      if (offset + 64 > miniStream.length) throw new Error('attachment_cfb_ministream_invalid');
      return miniStream.subarray(offset, offset + 64);
    });
    const stream = concatBytes(parts, MESSENGER_ATTACHMENT_MAX_BYTES);
    if (stream.length < entry.size) throw new Error('attachment_cfb_stream_truncated');
    return stream.subarray(0, entry.size);
  }
  const chain = cfbChain(entry.startSector, fat, Math.ceil(entry.size / sectorSize) + 1);
  const stream = concatBytes(
    chain.map((sectorId) => cfbSector(bytes, sectorSize, sectorId)),
    MESSENGER_ATTACHMENT_MAX_BYTES + sectorSize,
  );
  if (stream.length < entry.size) throw new Error('attachment_cfb_stream_truncated');
  return stream.subarray(0, entry.size);
}

function canonicalCfbName(name: string): string {
  return name.replace(/^[\u0000-\u001f]+/, '').trim().toLocaleLowerCase('en-US');
}

function assertLegacyOfficeStream(family: 'doc' | 'xls' | 'ppt', stream: Uint8Array) {
  if (stream.length < 8 || hasPlausibleEmbeddedExecutable(stream)) {
    throw new Error('attachment_cfb_office_stream_invalid');
  }
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  if (family === 'doc') {
    if (
      stream.length < 32
      || view.getUint16(0, true) !== 0xa5ec
      || view.getUint16(2, true) < 0x0065
      || view.getUint16(2, true) > 0x0112
      || view.getUint32(24, true) > view.getUint32(28, true)
    ) {
      throw new Error('attachment_cfb_word_fib_invalid');
    }
    return;
  }
  if (family === 'xls') {
    const recordLength = view.getUint16(2, true);
    if (
      view.getUint16(0, true) !== 0x0809
      || recordLength < 4
      || recordLength > 16
      || recordLength + 4 > stream.length
      || ![0x0500, 0x0600].includes(view.getUint16(4, true))
      || view.getUint16(6, true) !== 0x0005
    ) {
      throw new Error('attachment_cfb_excel_biff_invalid');
    }
    return;
  }
  if (
    (view.getUint16(0, true) & 0x000f) !== 0x000f
    || view.getUint16(2, true) !== 0x03e8
    || view.getUint32(4, true) > stream.length - 8
  ) {
    throw new Error('attachment_cfb_powerpoint_record_invalid');
  }
}

function inspectCfb(bytes: Uint8Array): 'doc' | 'xls' | 'ppt' {
  if (bytes.length < 512 || !startsWith(bytes, CFB_SIGNATURE)) {
    throw new Error('attachment_cfb_header_invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVersion = view.getUint16(26, true);
  const sectorShift = view.getUint16(30, true);
  const sectorSize = 2 ** sectorShift;
  if (
    ![3, 4].includes(majorVersion)
    || view.getUint16(28, true) !== 0xfffe
    || !((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12))
    || view.getUint16(32, true) !== 6
    || bytes.length < sectorSize * 2
    || bytes.length % sectorSize !== 0
    || view.getUint32(56, true) !== 4096
    || (majorVersion === 3 && view.getUint32(40, true) !== 0)
  ) {
    throw new Error('attachment_cfb_header_invalid');
  }
  const totalSectors = bytes.length / sectorSize - 1;
  const fatSectorCount = view.getUint32(44, true);
  const firstDirectorySector = view.getUint32(48, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);
  if (
    fatSectorCount < 1
    || fatSectorCount > totalSectors
    || miniFatSectorCount > totalSectors
    || difatSectorCount > totalSectors
  ) {
    throw new Error('attachment_cfb_header_bounds');
  }

  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const sectorId = view.getUint32(76 + index * 4, true);
    if (sectorId !== CFB_FREESECT) fatSectorIds.push(sectorId);
  }
  let nextDifat = firstDifatSector;
  const visitedDifat = new Set<number>();
  for (let index = 0; index < difatSectorCount; index += 1) {
    if (visitedDifat.has(nextDifat)) throw new Error('attachment_cfb_difat_invalid');
    visitedDifat.add(nextDifat);
    const sector = cfbSector(bytes, sectorSize, nextDifat);
    for (let item = 0; item < sectorSize / 4 - 1; item += 1) {
      const sectorId = uint32(sector, item * 4);
      if (sectorId !== CFB_FREESECT) fatSectorIds.push(sectorId);
    }
    nextDifat = uint32(sector, sectorSize - 4);
  }
  if (
    fatSectorIds.length !== fatSectorCount
    || new Set(fatSectorIds).size !== fatSectorIds.length
    || fatSectorIds.some((sectorId) => sectorId >= totalSectors)
    || (difatSectorCount === 0 && firstDifatSector !== CFB_ENDOFCHAIN)
    || (difatSectorCount > 0 && nextDifat !== CFB_ENDOFCHAIN)
  ) {
    throw new Error('attachment_cfb_difat_invalid');
  }

  const fat = fatSectorIds.flatMap((sectorId) => {
    const sector = cfbSector(bytes, sectorSize, sectorId);
    return Array.from({ length: sectorSize / 4 }, (_, index) => uint32(sector, index * 4));
  });
  if (
    fat.length < totalSectors
    || fatSectorIds.some((sectorId) => fat[sectorId] !== CFB_FATSECT)
    || Array.from(visitedDifat).some((sectorId) => fat[sectorId] !== CFB_DIFSECT)
  ) {
    throw new Error('attachment_cfb_fat_invalid');
  }

  const directory = concatBytes(
    cfbChain(firstDirectorySector, fat, Math.min(totalSectors, CFB_MAX_CHAIN))
      .map((sectorId) => cfbSector(bytes, sectorSize, sectorId)),
    CFB_MAX_DIRECTORY_ENTRIES * 128,
  );
  if (
    directory.length < 128
    || directory.length % 128 !== 0
    || directory.length / 128 > CFB_MAX_DIRECTORY_ENTRIES
  ) {
    throw new Error('attachment_cfb_directory_invalid');
  }

  const entries: CfbEntry[] = [];
  const directoryCount = directory.length / 128;
  for (let index = 0; index < directoryCount; index += 1) {
    const raw = directory.subarray(index * 128, (index + 1) * 128);
    const type = raw[66] ?? 0;
    if (type === 0) continue;
    if (![1, 2, 5].includes(type)) throw new Error('attachment_cfb_directory_invalid');
    const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (majorVersion === 3 && type === 2 && rawView.getUint32(124, true) !== 0) {
      throw new Error('attachment_cfb_stream_bounds');
    }
    const sizeBig = rawView.getBigUint64(120, true);
    if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('attachment_cfb_stream_bounds');
    for (const pointerOffset of [68, 72, 76]) {
      const pointer = rawView.getUint32(pointerOffset, true);
      if (pointer !== CFB_FREESECT && pointer >= directoryCount) {
        throw new Error('attachment_cfb_directory_invalid');
      }
    }
    entries.push({
      name: decodeCfbName(raw),
      type,
      startSector: rawView.getUint32(116, true),
      size: Number(sizeBig),
    });
  }
  const roots = entries.filter((entry) => entry.type === 5);
  if (roots.length !== 1 || roots[0]!.name !== 'Root Entry') {
    throw new Error('attachment_cfb_root_invalid');
  }
  const names = entries.map((entry) => canonicalCfbName(entry.name));
  if (new Set(names).size !== names.length) throw new Error('attachment_cfb_directory_invalid');
  const nameSet = new Set(names);
  if (
    nameSet.has('fileheader')
    || nameSet.has('bodytext')
    || nameSet.has('bindata')
    || nameSet.has('hwp document file')
  ) {
    throw new Error('attachment_cfb_hwp_rejected');
  }
  if (names.some((name) =>
    name === 'vba'
    || name === 'macros'
    || name === '_vba_project_cur'
    || name.includes('vbaproject')
  )) {
    throw new Error('attachment_cfb_macro_rejected');
  }
  if (names.some((name) =>
    name === 'objectpool'
    || name === 'package'
    || name === 'ole10native'
    || name.includes('ole10native')
  )) {
    throw new Error('attachment_cfb_embedded_object_rejected');
  }

  const miniFat: number[] = [];
  if (miniFatSectorCount > 0) {
    const miniFatBytes = concatBytes(
      cfbChain(firstMiniFatSector, fat, miniFatSectorCount)
        .map((sectorId) => cfbSector(bytes, sectorSize, sectorId)),
    );
    miniFat.splice(
      0,
      miniFat.length,
      ...Array.from(
        { length: miniFatBytes.length / 4 },
        (_, index) => uint32(miniFatBytes, index * 4),
      ),
    );
  }
  const root = roots[0]!;
  const miniStream = root.size > 0
    ? concatBytes(
      cfbChain(root.startSector, fat, Math.ceil(root.size / sectorSize) + 1)
        .map((sectorId) => cfbSector(bytes, sectorSize, sectorId)),
      root.size + sectorSize,
    ).subarray(0, root.size)
    : new Uint8Array();

  const candidates: Array<[string, 'doc' | 'xls' | 'ppt']> = [
    ['WordDocument', 'doc'],
    ['Workbook', 'xls'],
    ['Book', 'xls'],
    ['PowerPoint Document', 'ppt'],
  ];
  const matches = candidates.filter(([name]) =>
    entries.some((entry) => entry.type === 2 && entry.name === name)
  );
  const families = new Set(matches.map(([, family]) => family));
  if (matches.length < 1) throw new Error('attachment_cfb_office_stream_missing');
  if (families.size !== 1) throw new Error('attachment_cfb_office_stream_ambiguous');
  const stream = entries.find((entry) =>
    entry.type === 2 && entry.name === matches[0]![0]
  )!;
  const family = matches[0]![1];
  assertLegacyOfficeStream(
    family,
    readCfbStream(bytes, sectorSize, fat, miniFat, miniStream, stream),
  );
  for (const secondary of entries) {
    if (secondary.type !== 2 || secondary === stream || secondary.size === 0) continue;
    const content = readCfbStream(bytes, sectorSize, fat, miniFat, miniStream, secondary);
    if (hasPlausibleEmbeddedExecutable(content)) {
      throw new Error('attachment_cfb_executable_stream_rejected');
    }
  }
  return family;
}

async function inflatePdfObjectStreamBounded(
  bytes: Uint8Array,
  maximum: number,
): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.length;
    if (total > maximum) {
      await reader.cancel();
      throw new Error('attachment_pdf_object_stream_bounds');
    }
    chunks.push(result.value);
  }
  return concatBytes(chunks, maximum);
}

async function assertPdfSafe(bytes: Uint8Array) {
  if (!ascii(bytes, 0, Math.min(1024, bytes.length)).startsWith('%PDF-')) {
    throw new Error('attachment_pdf_header_invalid');
  }
  if (hasEmbeddedZip(bytes) || hasPlausibleEmbeddedExecutable(bytes)) {
    throw new Error('attachment_pdf_embedded_content_rejected');
  }
  const source = ascii(bytes);
  const normalized = source.replace(
    /#([0-9a-f]{2})/gi,
    (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
  );
  if (
    /\/Type\s*\/EmbeddedFile\b/i.test(normalized)
    || /\/Filespec\b/i.test(normalized)
    || /\/EF\s*<</i.test(normalized)
    || /\/JavaScript\b/i.test(normalized)
    || /\/JS\s*(?:\(|<)/i.test(normalized)
    || /\/Launch\b/i.test(normalized)
    || /\/RichMedia\b/i.test(normalized)
  ) {
    throw new Error('attachment_pdf_active_content_rejected');
  }
  const objectStreamPattern =
    /<<(?:[^>]|>(?!>)){0,8192}\/Type\s*\/ObjStm\b(?:[^>]|>(?!>)){0,8192}>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gi;
  for (const match of normalized.matchAll(objectStreamPattern)) {
    const dictionary = match[0].slice(0, match[0].indexOf('stream'));
    if (/\/Filter\b/i.test(dictionary) && !/\/Filter\s*\/FlateDecode\b/i.test(dictionary)) {
      throw new Error('attachment_pdf_object_stream_filter_rejected');
    }
    const encoded = Uint8Array.from(
      match[1],
      (character) => character.charCodeAt(0) & 0xff,
    );
    const decoded = /\/Filter\s*\/FlateDecode\b/i.test(dictionary)
      ? await inflatePdfObjectStreamBounded(encoded, MESSENGER_ATTACHMENT_MAX_BYTES)
      : encoded;
    const decodedText = ascii(decoded).replace(
      /#([0-9a-f]{2})/gi,
      (_innerMatch, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (
      /\/Type\s*\/EmbeddedFile\b/i.test(decodedText)
      || /\/Filespec\b/i.test(decodedText)
      || /\/JavaScript\b/i.test(decodedText)
      || /\/Launch\b/i.test(decodedText)
    ) {
      throw new Error('attachment_pdf_active_content_rejected');
    }
  }
}

function inspectSimpleFamily(bytes: Uint8Array): MessengerAttachmentFamily | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'heif';
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  return isStrictUtf8PlainText(bytes) ? 'txt' : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function inspectMessengerAttachment(input: {
  name: string;
  declaredMimeType: string;
  expectedSize: number;
  expectedSha256: string;
  bytes: Uint8Array;
}): Promise<InspectedMessengerAttachment> {
  const name = normalizeMessengerAttachmentFilename(input.name);
  const expectedSha256 = normalizeMessengerAttachmentSha256(input.expectedSha256);
  const declaredMimeType = input.declaredMimeType.trim().toLowerCase();
  if (!name) throw new Error('invalid_attachment_name');
  if (
    input.bytes.length < 1
    || input.bytes.length > MESSENGER_ATTACHMENT_MAX_BYTES
    || input.bytes.length !== input.expectedSize
  ) {
    throw new Error('invalid_attachment_size');
  }
  const extension = extensionOf(name);
  if (!extension) throw new Error('invalid_attachment_extension');
  const mimeType = EXTENSION_MIME[extension];
  if (mimeType !== declaredMimeType) throw new Error('invalid_attachment_mime');
  const actualSha256 = await sha256Hex(input.bytes);
  if (!expectedSha256 || actualSha256 !== expectedSha256) {
    throw new Error('invalid_attachment_hash');
  }

  const expectedFamily = EXPECTED_FAMILY[extension];
  let family: MessengerAttachmentFamily | null;
  if (expectedFamily === 'docx' || expectedFamily === 'xlsx' || expectedFamily === 'pptx') {
    family = await inspectOoxml(input.bytes, expectedFamily);
  } else if (expectedFamily === 'doc' || expectedFamily === 'xls' || expectedFamily === 'ppt') {
    family = inspectCfb(input.bytes);
  } else {
    family = inspectSimpleFamily(input.bytes);
    if (family === 'pdf') await assertPdfSafe(input.bytes);
    if (family && !['pdf', 'txt'].includes(family)) {
      if (hasPlausibleEmbeddedExecutable(input.bytes) || hasEmbeddedZip(input.bytes)) {
        throw new Error('invalid_attachment_polyglot');
      }
    }
  }
  const heifCompatible =
    (family === 'heic' || family === 'heif')
    && (expectedFamily === 'heic' || expectedFamily === 'heif');
  if (!family || (!heifCompatible && family !== expectedFamily)) {
    throw new Error('invalid_attachment_content');
  }
  return {
    extension,
    mimeType,
    family: heifCompatible ? expectedFamily : family,
    sha256: actualSha256,
    size: input.bytes.length,
  };
}

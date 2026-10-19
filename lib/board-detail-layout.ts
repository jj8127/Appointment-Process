/**
 * Pure helpers for the board post detail: the lead shown at the top of the first screen,
 * and the short file-kind label on attachment cards.
 */

const LEAD_MAX_LENGTH = 160;
// Staff sometimes type "." just to post an attachment; text without two letters or digits says nothing.
const hasWords = (value: string) => (value.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

export type BoardPostLead = { lead: string; rest: string };

/**
 * The first paragraph (or first line when there are no blank lines) becomes the lead.
 * A long opening paragraph is not a summary, so it stays in the body and no lead is shown.
 * Placeholder text ("." and the like) is dropped entirely.
 */
export function splitBoardPostLead(content: string | null | undefined): BoardPostLead {
  const text = (content ?? '').replace(/\r\n/g, '\n').trim();
  if (!hasWords(text)) return { lead: '', rest: '' };
  const paragraphBreak = text.search(/\n\s*\n/);
  const lineBreak = text.indexOf('\n');
  const cut = paragraphBreak >= 0 ? paragraphBreak : lineBreak;
  const lead = (cut >= 0 ? text.slice(0, cut) : text).trim();
  if (lead.length > LEAD_MAX_LENGTH || !hasWords(lead)) return { lead: '', rest: text };
  return { lead, rest: cut >= 0 ? text.slice(cut).trim() : '' };
}

const FILE_KINDS: [RegExp, string][] = [
  [/^pdf$/, 'PDF'],
  [/^(xlsx?|csv)$/, 'XLS'],
  [/^pptx?$/, 'PPT'],
  [/^docx?$/, 'DOC'],
  [/^(hwp|hwpx)$/, 'HWP'],
  [/^(zip|7z|rar)$/, 'ZIP'],
  [/^(jpe?g|png|gif|webp|heic)$/, 'IMG'],
];

/** Short uppercase label for an attachment card, from the file extension, then the MIME type. */
export function getBoardFileKind(fileName: string | null | undefined, mimeType?: string | null): string {
  const extension = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  const fromExtension = FILE_KINDS.find(([pattern]) => pattern.test(extension))?.[1];
  if (fromExtension) return fromExtension;
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType?.startsWith('image/')) return 'IMG';
  return '파일';
}

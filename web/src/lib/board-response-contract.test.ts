import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  hasValidBoardCategories,
  hasValidBoardDetailAttachmentUrls,
  hasValidBoardListAttachmentUrls,
  parseBoardAttachmentSignRows,
} from './board-response-contract.ts';
import { CANONICAL_BOARD_CATEGORIES } from '../../../supabase/functions/_shared/board-categories.ts';

const attachment = {
  id: 'attachment-1',
  fileType: 'image',
  fileName: 'image.png',
  fileSize: 10,
  storagePath: 'board/post/image.png',
  signedUrl: 'https://storage.example.test/image.png',
};

const unsafeUrls = [
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'http://storage.example.test/file',
  'https://user:secret@storage.example.test/file',
];

const listItem = {
  id: 'post-1',
  categoryId: 'category-1',
  title: '제목',
  contentPreview: '본문',
  authorName: '작성자',
  authorRole: 'admin',
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  isPinned: false,
  isMine: true,
  stats: { commentCount: 0, reactionCount: 0, attachmentCount: 1, viewCount: 1 },
  reactions: { like: 0, heart: 0, check: 0, smile: 0 },
  attachments: [attachment],
};

const detail = {
  post: {
    id: 'post-1',
    categoryId: 'category-1',
    title: '제목',
    content: '본문',
    authorName: '작성자',
    authorRole: 'admin',
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
    isPinned: false,
    isMine: true,
    viewCount: 1,
  },
  attachments: [attachment],
  reactions: { like: 0, heart: 0, check: 0, smile: 0, myReaction: null },
  comments: [],
};

test('board list and detail attachments allow only optional credential-free HTTPS URLs', () => {
  assert.equal(hasValidBoardListAttachmentUrls({ items: [listItem] }), true);
  assert.equal(hasValidBoardListAttachmentUrls({
    items: [{ ...listItem, attachments: [{ ...attachment, signedUrl: undefined }] }],
  }), true);
  assert.equal(hasValidBoardDetailAttachmentUrls(detail, 'post-1'), true);

  for (const signedUrl of unsafeUrls) {
    const malformedAttachment = { ...attachment, signedUrl };
    assert.equal(hasValidBoardListAttachmentUrls({
      items: [{ ...listItem, attachments: [malformedAttachment] }],
    }), false);
    assert.equal(hasValidBoardDetailAttachmentUrls({
      ...detail,
      attachments: [malformedAttachment],
    }), false);
  }
});

test('board read contracts reject malformed rows, duplicates, and wrong detail identities', () => {
  const categories = CANONICAL_BOARD_CATEGORIES.map((category, index) => ({
    id: `category-${index + 1}`,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    isActive: true,
  }));
  assert.equal(hasValidBoardCategories(categories), true);
  assert.equal(hasValidBoardCategories(null), false);
  assert.equal(hasValidBoardCategories(categories.slice(0, -1)), false);
  assert.equal(hasValidBoardCategories([
    ...categories.slice(0, -1),
    { ...categories.at(-1)!, id: categories[0].id },
  ]), false);
  assert.equal(hasValidBoardCategories([
    { ...categories[0], name: '잘못된 이름' },
    ...categories.slice(1),
  ]), false);
  assert.equal(hasValidBoardListAttachmentUrls({ items: [{ ...listItem, stats: { ...listItem.stats, commentCount: null } }] }), false);
  assert.equal(hasValidBoardListAttachmentUrls({ items: [listItem, listItem] }), false);
  assert.equal(hasValidBoardDetailAttachmentUrls(detail, 'post-2'), false);
  assert.equal(hasValidBoardDetailAttachmentUrls({ ...detail, comments: [null] }), false);
});

test('board attachment signing requires one valid row per requested file', () => {
  const valid = [{
    storagePath: 'board/post/image.png',
    signedUrl: 'https://storage.example.test/upload',
  }];
  assert.deepStrictEqual(parseBoardAttachmentSignRows(valid, [valid[0].storagePath]), valid);
  assert.equal(parseBoardAttachmentSignRows([], [valid[0].storagePath]), null);
  assert.equal(parseBoardAttachmentSignRows([{}], [valid[0].storagePath]), null);
  assert.equal(parseBoardAttachmentSignRows(valid, ['board/post/other.png']), null);
  assert.equal(parseBoardAttachmentSignRows([valid[0], valid[0]], [undefined, undefined]), null);
  for (const signedUrl of unsafeUrls) {
    assert.equal(parseBoardAttachmentSignRows([{ ...valid[0], signedUrl }], [valid[0].storagePath]), null);
  }
});

test('board client applies the URL contracts before returning data to page sinks', () => {
  const source = readFileSync('web/src/lib/board-api.ts', 'utf8');
  assert.match(source, /hasValidBoardListAttachmentUrls\(result\)/);
  assert.match(source, /hasValidBoardCategories\(result\)/);
  assert.match(source, /hasValidBoardDetailAttachmentUrls\(result, postId\)/);
  assert.match(source, /parseBoardAttachmentSignRows\([\s\S]*files\.map\(\(file\) => file\.storagePath\)/);
});

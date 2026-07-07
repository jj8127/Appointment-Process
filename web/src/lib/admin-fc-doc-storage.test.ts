import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeFcDocumentStoragePath } from './admin-fc-doc-storage.ts';

test('normalizes raw FC document storage keys', () => {
  assert.equal(
    normalizeFcDocumentStoragePath(' /fc-123/hanwha approval.pdf '),
    'fc-123/hanwha approval.pdf',
  );
});

test('removes an accidental fc-documents bucket prefix', () => {
  assert.equal(
    normalizeFcDocumentStoragePath('fc-documents/fc-123/id-card.pdf'),
    'fc-123/id-card.pdf',
  );
});

test('extracts object key from full signed storage URLs', () => {
  assert.equal(
    normalizeFcDocumentStoragePath(
      'https://example.supabase.co/storage/v1/object/sign/fc-documents/fc-123/doc.pdf?token=abc',
    ),
    'fc-123/doc.pdf',
  );
});

test('extracts object key from relative signed storage paths', () => {
  assert.equal(
    normalizeFcDocumentStoragePath('/storage/v1/object/sign/fc-documents/fc-123/doc.pdf?token=abc'),
    'fc-123/doc.pdf',
  );
});

test('extracts and decodes object key from public storage URLs', () => {
  assert.equal(
    normalizeFcDocumentStoragePath(
      'https://example.supabase.co/storage/v1/object/public/fc-documents/fc-123/%ED%95%9C%ED%99%94.pdf',
    ),
    'fc-123/한화.pdf',
  );
});

test('rejects absolute URLs that are not fc-documents storage URLs', () => {
  assert.equal(
    normalizeFcDocumentStoragePath('https://example.com/not-storage/fc-123/doc.pdf'),
    '',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isExactNoticeMutationReceipt,
  isNoticeDeleteInput,
  isNoticePatchInput,
} from './notice-write-contract.ts';

test('notice write contracts accept safe HTTPS attachments', () => {
  assert.equal(isNoticePatchInput({
    id: 'notice-1',
    title: '공지',
    images: ['https://storage.example.test/image.png'],
    files: [{
      name: 'notice.pdf',
      size: 12,
      type: 'application/pdf',
      url: 'https://storage.example.test/notice.pdf',
    }],
  }), true);
  assert.equal(isNoticeDeleteInput({ id: 'notice-1' }), true);
});

test('notice write contracts reject non-record bodies and unsafe attachment URLs', () => {
  for (const value of [null, [], 'notice-1']) {
    assert.equal(isNoticePatchInput(value), false);
    assert.equal(isNoticeDeleteInput(value), false);
  }
  for (const url of [
    'http://storage.example.test/image.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA==',
    'https://user:password@storage.example.test/image.png',
  ]) {
    assert.equal(isNoticePatchInput({ images: [url] }), false);
    assert.equal(isNoticePatchInput({ files: [{ name: 'x', url }] }), false);
  }
  assert.equal(isNoticePatchInput({ images: 'https://storage.example.test/image.png' }), false);
  assert.equal(isNoticePatchInput({ files: [{ name: 'x', url: 'https://storage.example.test/x', size: -1 }] }), false);
});

test('notice mutation receipts bind the committed row and fields to the request', () => {
  const expected = {
    id: 'notice-1',
    title: '수정 제목',
    images: ['https://storage.example.test/image.png'],
    files: [{ name: 'notice.pdf', size: 12, type: 'application/pdf', url: 'https://storage.example.test/notice.pdf' }],
  };
  assert.equal(isExactNoticeMutationReceipt({
    ...expected,
    body: 'unchanged',
    category: 'notice',
  }, expected), true);

  assert.equal(isExactNoticeMutationReceipt({ ...expected, id: 'notice-2' }, expected), false);
  assert.equal(isExactNoticeMutationReceipt({ ...expected, title: '다른 제목' }, expected), false);
  assert.equal(isExactNoticeMutationReceipt({ ...expected, images: [] }, expected), false);
  assert.equal(isExactNoticeMutationReceipt(null, expected), false);
});

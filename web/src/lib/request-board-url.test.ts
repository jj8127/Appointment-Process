import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRequestBoardMessengerConfig } from './request-board-url.ts';

test('returns configured messenger URL when NEXT_PUBLIC_REQUEST_BOARD_URL is valid', () => {
  assert.deepStrictEqual(
    resolveRequestBoardMessengerConfig({ requestBoardUrl: ' https://requestboard.example.com/ ' }),
    {
      available: true,
      baseUrl: 'https://requestboard.example.com',
      messengerUrl: 'https://requestboard.example.com/m/chat',
      source: 'env',
    },
  );
});

test('disables request-board messenger when no public URL is configured', () => {
  assert.deepStrictEqual(
    resolveRequestBoardMessengerConfig({ requestBoardUrl: '' }),
    {
      available: false,
      baseUrl: null,
      messengerUrl: null,
      reason: 'missing-public-url',
    },
  );
});

test('surfaces invalid request-board URL configuration explicitly', () => {
  assert.deepStrictEqual(
    resolveRequestBoardMessengerConfig({ requestBoardUrl: 'notaurl' }),
    {
      available: false,
      baseUrl: null,
      messengerUrl: null,
      reason: 'invalid-public-url',
    },
  );
});

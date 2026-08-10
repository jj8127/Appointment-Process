import {
  collectGroupChatDataApiBatches,
  collectGroupChatDataApiPages,
  GROUP_CHAT_DATA_API_BATCH_SIZE,
  chunkGroupChatDataApiValues,
} from '../../supabase/functions/_shared/group-chat-data-api-batching';

describe('group chat Data API batching', () => {
  test('bounds the 535-recipient fanout behind the reported 536-member room', () => {
    const recipients = Array.from({ length: 535 }, (_, index) => `actor-${index}`);

    const batches = chunkGroupChatDataApiValues(recipients);

    expect(GROUP_CHAT_DATA_API_BATCH_SIZE).toBe(100);
    expect(batches).toHaveLength(6);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 100, 100, 100, 35]);
    expect(batches.flat()).toEqual(recipients);
  });

  test('returns no query batch for an empty audience', () => {
    expect(chunkGroupChatDataApiValues([])).toEqual([]);
  });

  test('copies each batch so callers cannot mutate the source audience', () => {
    const source = ['first', 'second'];
    const [batch] = chunkGroupChatDataApiValues(source);

    batch.push('third');

    expect(source).toEqual(['first', 'second']);
  });

  test('collects every recipient even when one Data API response is bounded', async () => {
    const recipients = Array.from({ length: 535 }, (_, index) => `actor-${index}`);
    const requestedBatchSizes: number[] = [];

    const result = await collectGroupChatDataApiBatches(
      recipients,
      async (batch) => {
        requestedBatchSizes.push(batch.length);
        return { data: batch.slice(0, 500), error: null };
      },
    );

    expect(result).toEqual({ ok: true, data: recipients });
    expect(requestedBatchSizes).toEqual([100, 100, 100, 100, 100, 35]);
  });

  test('paginates a member table beyond the project response cap', async () => {
    const members = Array.from({ length: 514 }, (_, index) => `member-${index}`);

    const result = await collectGroupChatDataApiPages(async (from, to) => ({
      data: members.slice(from, to + 1),
      error: null,
    }));

    expect(result).toEqual({ ok: true, data: members });
  });

  test('advances by returned rows when the configured response cap is below the requested page', async () => {
    const members = Array.from({ length: 214 }, (_, index) => `member-${index}`);
    const requestedFrom: number[] = [];

    const result = await collectGroupChatDataApiPages(async (from, to) => {
      requestedFrom.push(from);
      return {
        data: members.slice(from, Math.min(to + 1, from + 40)),
        error: null,
      };
    });

    expect(result).toEqual({ ok: true, data: members });
    expect(requestedFrom).toEqual([0, 40, 80, 120, 160, 200, 214]);
  });

  test('fails closed when any bounded query fails', async () => {
    const recipients = Array.from({ length: 201 }, (_, index) => `actor-${index}`);

    const result = await collectGroupChatDataApiBatches(
      recipients,
      async (batch) => ({
        data: batch,
        error: batch[0] === 'actor-100' ? new Error('test_error') : null,
      }),
    );

    expect(result).toEqual({ ok: false });
  });
});

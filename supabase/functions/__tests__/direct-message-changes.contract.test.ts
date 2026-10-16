import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fcNotify = readFileSync(join(__dirname, '..', 'fc-notify', 'index.ts'), 'utf8');
const listBlock = fcNotify.slice(
  fcNotify.indexOf("if (body.type === 'direct_message_list') {"),
  fcNotify.indexOf("mode: since ? 'changes' : 'full',") + 200,
);

describe('1:1 list answers with changes after a cursor', () => {
  it('reads only rows changed since the cursor, minus an overlap window', () => {
    expect(fcNotify).toContain("if (options?.changedSince) query = query.gte('changed_at', options.changedSince);");
    expect(fcNotify.split("query.gte('changed_at', options.changedSince)").length - 1).toBe(2);
    expect(listBlock).toContain('since.getTime() - DIRECT_MESSAGE_CURSOR_OVERLAP_MS');
    expect(fcNotify).toContain('const DIRECT_MESSAGE_CURSOR_OVERLAP_MS = 10_000;');
  });

  it('keeps the whole-conversation answer when no usable cursor is sent', () => {
    expect(listBlock).toContain('const since = parseDirectMessageCursor(body.since);');
    expect(listBlock).toContain("mode: since ? 'changes' : 'full',");
    const parser = fcNotify.slice(fcNotify.indexOf('function parseDirectMessageCursor('), fcNotify.indexOf('function latestDirectMessageChange('));
    expect(parser).toContain('time < now - DIRECT_MESSAGE_CURSOR_MAX_AGE_MS');
    expect(parser).toContain('time > now + 60_000');
  });

  it('reports deletes as ids, only for rows this viewer may see', () => {
    expect(listBlock).toContain('row.deleted_at !== null && isVisibleCurrentRow(row)');
    expect(listBlock).toContain('row.deleted_at !== null && isVisibleLegacyRow(row)');
    expect(listBlock).toContain('deleted_ids: deletedIds,');
  });

  it('returns the newest change time it saw, deleted rows included, as the next cursor', () => {
    expect(listBlock).toContain('latestDirectMessageChange([...currentQueryRows, ...legacyQueryRows])');
    expect(listBlock).toContain('cursor,');
  });

  it('hands out the realtime channel only on a full load, without delaying it', () => {
    expect(listBlock).toContain('since ? Promise.resolve(null) : loadDirectMessageRealtimeTopic(resolution.threadId),');
    expect(listBlock).toContain('realtime_topic: realtimeTopic,');
    const loader = fcNotify.slice(fcNotify.indexOf('async function loadDirectMessageRealtimeTopic('), fcNotify.indexOf('function latestDirectMessageChange('));
    expect(loader).toContain("supabase.rpc('messenger_direct_realtime_topic_v1'");
    expect(loader).toContain('/^dm-[0-9a-f]{64}$/');
    expect(loader).toContain('return null;');
  });

  it('leaves the other caller on the old column set', () => {
    expect(fcNotify.split('collectCurrentMessageRows(),').length - 1).toBe(1);
    expect(fcNotify.split('collectLegacyMessageRows(),').length - 1).toBe(1);
  });
});

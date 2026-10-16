import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fcNotify = readFileSync(join(__dirname, '..', 'fc-notify', 'index.ts'), 'utf8');
const resolver = fcNotify.slice(
  fcNotify.indexOf('async function resolveGaraminDirectConversation('),
  fcNotify.indexOf('async function resolveGaraminDirectConversation(') + 6000,
);

describe('1:1 thread check in one database call', () => {
  it('reads an existing thread through the snapshot function and falls back on any failure', () => {
    const loader = fcNotify.slice(fcNotify.indexOf('async function loadDirectThreadSnapshot('), fcNotify.indexOf('async function resolveGaraminDirectConversation('));
    expect(loader).toContain("supabase.rpc('messenger_direct_thread_snapshot_v1'");
    expect(loader).toContain('if (error || !isRecord(data) || !isRecord(data.thread)) return null;');
    expect(loader).toMatch(/\} catch \{\s*return null;/);
    expect(resolver).toContain('} else if (input.conversationId) {');
  });

  it('judges the counterparty with the same function the query path uses', () => {
    expect(resolver).toContain('const snapshotCounterparty = judgeActiveDirectCounterparty(');
    const resolveActive = fcNotify.slice(fcNotify.indexOf('async function resolveActiveDirectCounterparty('), fcNotify.indexOf('async function resolveDirectCounterpartyFromTarget('));
    expect(resolveActive).toContain('judgeActiveDirectCounterparty(input, await fetchDirectCounterpartyAccountRows(input))');
  });

  it('keeps the access check before using the snapshot', () => {
    const snapshotBranch = resolver.slice(resolver.indexOf('if (snapshot) {'), resolver.indexOf('} else if (input.conversationId) {'));
    expect(snapshotBranch.indexOf('canAccessDirectConversation(')).toBeGreaterThan(snapshotBranch.indexOf('judgeActiveDirectCounterparty('));
    expect(snapshotBranch.indexOf('thread = snapshot.thread;')).toBeGreaterThan(snapshotBranch.indexOf('canAccessDirectConversation('));
  });
});

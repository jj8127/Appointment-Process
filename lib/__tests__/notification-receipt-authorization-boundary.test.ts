import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const source = readFileSync(
  join(root, 'supabase', 'functions', 'fc-notify', 'index.ts'),
  'utf8',
);

describe('notification receipt authorization boundary', () => {
  it('loads an exact notification before authorization and distinguishes missing from denied', () => {
    expect(source).toContain(".eq('id', body.notification_id)");
    expect(source).toContain("return err('Notification not found', 404)");
    expect(source).toContain('authorizeNotificationReceipt(');
    expect(source).toContain("return err('Notification access denied', 403)");
  });

  it('returns only the stored typed target from inbox_get', () => {
    expect(source).toContain('authorized: true');
    expect(source).toContain('target: parseNotificationTargetV1(data.target)');
    expect(source).not.toContain('target: parseNotificationTargetV1(body.target)');
  });

  it('scopes list and unread queries by immutable actor id plus true broadcasts', () => {
    expect(source).toContain(
      '`recipient_actor_id.eq.${viewer.actorId},and(recipient_actor_id.is.null,resident_id.is.null)`',
    );
    expect(source).toContain(".eq('recipient_actor_id', viewer.actorId)");
  });

  it('authorizes the full requested set before any receipt write', () => {
    const ownershipLookupIndex = source.indexOf(
      ".select('id,recipient_actor_id,recipient_role,resident_id,category')",
    );
    const authorizationSetIndex = source.indexOf(
      'const ownershipSet = authorizeNotificationReceiptSet(',
    );
    const deniedCheckIndex = source.indexOf('if (ownershipSet.authorized === false)');
    const receiptWriteIndex = source.indexOf(
      'persistNotificationReceiptRows(receiptRows, viewer)',
      deniedCheckIndex,
    );

    expect(ownershipLookupIndex).toBeGreaterThan(-1);
    expect(authorizationSetIndex).toBeGreaterThan(ownershipLookupIndex);
    expect(deniedCheckIndex).toBeGreaterThan(authorizationSetIndex);
    expect(receiptWriteIndex).toBeGreaterThan(deniedCheckIndex);
    expect(source.slice(ownershipLookupIndex, receiptWriteIndex)).not.toContain(
      'return ok({ ok: true, updated: 0 })',
    );
    const mutationBoundary = source.slice(ownershipLookupIndex, authorizationSetIndex);
    expect(mutationBoundary).toMatch(
      /parseQueryRows\(\s*ownershipRows,\s*isNotificationOwnershipQueryRow/,
    );
    expect(mutationBoundary).toContain("return err('Notification ownership lookup failed', 500)");
    expect(mutationBoundary).not.toContain('ownershipRows ?? []');
  });

  it('rejects malformed receipt and unread ownership query successes', () => {
    const receiptStart = source.indexOf('async function fetchReceiptMap');
    const receiptEnd = source.indexOf('const requiredServiceKey', receiptStart);
    const receiptSource = source.slice(receiptStart, receiptEnd);
    expect(receiptSource).toContain('parseQueryRows(data, isReceiptQueryRow)');
    expect(receiptSource).toContain('notification_receipt_query_contract_invalid');
    expect(receiptSource).not.toContain('(data ?? [])');

    const unreadStart = source.lastIndexOf("if (body.type === 'inbox_unread_count')");
    const mutationStart = source.indexOf("if (body.type === 'inbox_mark_all_read')", unreadStart);
    const unreadSource = source.slice(unreadStart, mutationStart);
    expect(unreadSource).toContain('fetchVisibleNotificationOwnershipRows({');
    expect(unreadSource).not.toContain('primaryRows ?? []');
    expect(unreadSource).not.toContain('requestBoardFcRows = data ?? []');

    const ownershipPageStart = source.indexOf('function collectAllNotificationOwnershipRows');
    const ownershipPageEnd = source.indexOf('async function fetchVisibleNotificationOwnershipRows', ownershipPageStart);
    const ownershipPageSource = source.slice(ownershipPageStart, ownershipPageEnd);
    expect(ownershipPageSource).toContain('collectSupabaseRows<Record<string, unknown>>({');
    expect(ownershipPageSource).toContain('isRow: isNotificationOwnershipPageQueryRow');
    expect(ownershipPageSource).toContain('rowKey: (row) => String(row.id)');
    expect(ownershipPageSource).toContain('.range(from, to)');
  });

  it('reports first and idempotent receipt mutations explicitly', () => {
    expect(source).toContain('changed: changedStates.length > 0');
    expect(source).toContain("'already_dismissed'");
    expect(source).toContain("'already_read'");
    expect(source).toContain('updated: changedStates.length');
  });

  it('verifies the exact persisted receipt set and state before reporting success', () => {
    expect(source).toContain('async function persistNotificationReceiptRows(');
    expect(source).toContain(".select('notification_id,viewer_actor_id,viewer_role,read_at,dismissed_at')");
    expect(source).toContain('const persistedReceipts = parseQueryRows(');
    expect(source).toContain('persistedReceipts.length !== batchRows.length');
    expect(source).toContain('row.viewer_actor_id === viewer.actorId');
    expect(source).toContain('row.viewer_role === viewer.role');
    expect(source).toContain("from '../_shared/ux-mutation-contract.ts'");
    expect(source).toContain('mutationRowReceiptMatches(row, expectedReceipt)');
    expect(source).not.toContain('row.read_at !== expected.read_at');
    expect(source).not.toContain('row.dismissed_at !== expected.dismissed_at');
    expect(source).toContain("return err('Notification receipt update failed', 500)");
  });
});

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
    const upsertIndex = source.indexOf(
      ".from('notification_receipts')",
      deniedCheckIndex,
    );

    expect(ownershipLookupIndex).toBeGreaterThan(-1);
    expect(authorizationSetIndex).toBeGreaterThan(ownershipLookupIndex);
    expect(deniedCheckIndex).toBeGreaterThan(authorizationSetIndex);
    expect(upsertIndex).toBeGreaterThan(deniedCheckIndex);
    expect(source.slice(ownershipLookupIndex, upsertIndex)).not.toContain(
      'return ok({ ok: true, updated: 0 })',
    );
  });

  it('reports first and idempotent receipt mutations explicitly', () => {
    expect(source).toContain('changed: changedStates.length > 0');
    expect(source).toContain("'already_dismissed'");
    expect(source).toContain("'already_read'");
    expect(source).toContain('updated: changedStates.length');
  });
});

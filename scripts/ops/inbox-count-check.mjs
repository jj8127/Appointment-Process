// Prints what the bell would show for the test FC (A): the unread count with no
// stored notice checkpoint (a fresh install), and how many notifications and
// notices the first inbox page lists. Reads the MSGBOT_* variables; counts only.
import { createClient, readConfig } from './messenger-synthetic-traffic.mjs';

const config = readConfig();
const client = createClient(config);
const a = await client.login(config.a);
const count = (await client.fcNotify(a, {
  type: 'inbox_unread_count', role: 'fc', resident_id: config.a.phone, include_notices: true,
  notice_since: new Date(0).toISOString(),
})).json.count;
const list = (await client.fcNotify(a, { type: 'inbox_list', role: 'fc', resident_id: config.a.phone, limit: 200 })).json;
const oldest = (rows) => rows.length ? rows.map((row) => row.created_at).sort()[0] : '-';
console.log(`unread (fresh install): ${count}`);
console.log(`listed notifications: ${list.notifications?.length ?? 0} (oldest ${oldest(list.notifications ?? [])}), more=${list.notification_has_more}`);
console.log(`listed notices: ${list.notices?.length ?? 0} (oldest ${oldest(list.notices ?? [])}), more=${list.notice_has_more}`);

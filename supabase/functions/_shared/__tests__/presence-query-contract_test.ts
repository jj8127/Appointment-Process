/// <reference lib="deno.ns" />

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isExactStalePresenceReceipt,
  isExactTouchPresenceReceipt,
  isPresenceMutationSnapshot,
  isPresenceSnapshot,
  isPresenceTableRow,
  mergePresenceSnapshots,
  presenceRowsHaveUniquePhones,
  presenceRowsMatchRequestedPhones,
  samePresenceTimestamp,
} from "../presence-query-contract.ts";

const row = {
  phone: "01012345678",
  garam_in_at: null,
  garam_link_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
};

Deno.test("presence query rows reject malformed timestamps and snapshots", () => {
  assertEquals(isPresenceTableRow(row), true);
  assertEquals(isPresenceTableRow({ ...row, updated_at: "invalid" }), false);
  assertEquals(
    isPresenceSnapshot({
      ...row,
      last_seen_at: "2026-10-13T00:00:00Z",
      is_online: true,
    }),
    true,
  );
  assertEquals(isPresenceSnapshot({ ...row, last_seen_at: null }), false);
  assertEquals(
    isPresenceSnapshot({
      phone: row.phone,
      garam_in_at: null,
      garam_link_at: null,
      updated_at: null,
      last_seen_at: null,
      is_online: false,
    }),
    true,
  );
  assertEquals(
    isPresenceSnapshot({
      phone: row.phone,
      garam_in_at: null,
      garam_link_at: null,
      updated_at: null,
      last_seen_at: null,
      is_online: true,
    }),
    false,
  );
  assertEquals(isPresenceTableRow({ ...row, updated_at: null }), false);
});

Deno.test("presence timestamp equality uses one shared instant comparison", () => {
  assertEquals(
    samePresenceTimestamp(
      "2026-10-13T00:00:00.000Z",
      "2026-10-13T09:00:00.000+09:00",
    ),
    true,
  );
  assertEquals(samePresenceTimestamp(null, null), true);
  assertEquals(samePresenceTimestamp(null, row.updated_at), false);
});

Deno.test("presence query rows bind uniquely to the requested phone set", () => {
  assertEquals(
    presenceRowsMatchRequestedPhones([row], [row.phone], true),
    true,
  );
  assertEquals(
    presenceRowsMatchRequestedPhones([], [row.phone], true),
    false,
  );
  assertEquals(
    presenceRowsMatchRequestedPhones([row, row], [row.phone], false),
    false,
  );
  assertEquals(
    presenceRowsMatchRequestedPhones([row], ["01099999999"], false),
    false,
  );
  assertEquals(presenceRowsHaveUniquePhones([row]), true);
  assertEquals(presenceRowsHaveUniquePhones([row, row]), false);
});

Deno.test("presence snapshots fill only requested missing phones", () => {
  const snapshot = {
    ...row,
    last_seen_at: row.garam_link_at,
    is_online: true,
  };
  assertEquals(
    mergePresenceSnapshots([row.phone, "01099999999", row.phone], [snapshot]),
    [
      snapshot,
      {
        phone: "01099999999",
        garam_in_at: null,
        garam_link_at: null,
        updated_at: null,
        last_seen_at: null,
        is_online: false,
      },
    ],
  );
});

Deno.test("presence mutation receipts bind the requested phone and state", () => {
  const touchReceipt = {
    ...row,
    garam_in_at: row.updated_at,
    last_seen_at: row.updated_at,
    is_online: true,
  };
  assertEquals(isExactTouchPresenceReceipt(touchReceipt, row.phone), true);
  assertEquals(
    isExactTouchPresenceReceipt(touchReceipt, "01099999999"),
    false,
  );
  assertEquals(
    isExactTouchPresenceReceipt(
      { ...touchReceipt, garam_in_at: null },
      row.phone,
    ),
    false,
  );

  const staleAt = "1970-01-01T00:00:00.000Z";
  const appliedReceipt = {
    phone: row.phone,
    garam_in_at: staleAt,
    garam_link_at: null,
    updated_at: "2026-10-13T00:01:00Z",
    last_seen_at: staleAt,
    is_online: false,
    applied: true,
  };
  assertEquals(isPresenceMutationSnapshot(appliedReceipt), true);
  assertEquals(
    isExactStalePresenceReceipt(appliedReceipt, row.phone, null, staleAt),
    true,
  );
  assertEquals(
    isExactStalePresenceReceipt(
      { ...appliedReceipt, applied: false },
      row.phone,
      null,
      staleAt,
    ),
    false,
  );
  assertEquals(
    isPresenceMutationSnapshot({ ...appliedReceipt, applied: undefined }),
    false,
  );

  const currentAt = "2026-10-13T00:02:00Z";
  assertEquals(
    isExactStalePresenceReceipt(
      {
        ...appliedReceipt,
        garam_in_at: currentAt,
        updated_at: currentAt,
        last_seen_at: currentAt,
        applied: false,
      },
      row.phone,
      "2026-10-13T00:01:00Z",
      staleAt,
    ),
    true,
  );
});

Deno.test("user presence handler closes read and mutation receipts", async () => {
  const source = await Deno.readTextFile(
    new URL("../../user-presence/index.ts", import.meta.url),
  );
  for (
    const expected of [
      "parseQueryRows(data, isPresenceSnapshot)",
      "presenceRowsMatchRequestedPhones(rows, normalizedPhones, true)",
      "presenceRowsMatchRequestedPhones(rows, normalizedPhones, false)",
      "presenceRowsHaveUniquePhones(managerRows)",
      ".in('phone', scopedPhones)",
      "isExactTouchPresenceReceipt(rows[0], phone)",
      "isExactStalePresenceReceipt(",
      "updateQuery = updateQuery.eq('garam_in_at', expectedAt)",
      "data.phone !== phone",
      "const body = parseRequestBody(rawBody)",
    ]
  ) {
    assertEquals(source.includes(expected), true, expected);
  }
  assertEquals(source.includes("error.message"), false);
  assertEquals(source.includes("data ?? []"), false);
  assertEquals(source.includes("function cleanPhone"), false);
  assertEquals(source.includes("function sameTimestamp"), false);
});

Deno.test("web presence route and client reuse the strict shared contract", async () => {
  const route = await Deno.readTextFile(
    new URL("../../../../web/src/app/api/presence/route.ts", import.meta.url),
  );
  const client = await Deno.readTextFile(
    new URL("../../../../web/src/lib/presence-api.ts", import.meta.url),
  );
  for (
    const expected of [
      "requireSupabaseRowsMatching(data, 'presence_rpc', isPresenceSnapshot)",
      "presenceRowsMatchRequestedPhones(rows, normalizedPhones, true)",
      "presenceRowsMatchRequestedPhones(rows, normalizedPhones, false)",
      "mergePresenceSnapshots(normalizedPhones, rows.map(toPresenceSnapshot))",
      ".in('phone', scopedPhones)",
    ]
  ) {
    assertEquals(route.includes(expected), true, expected);
  }
  assertEquals(client.includes("collectPresenceSnapshotBatches"), true);
  assertEquals(route.includes("function cleanPhone"), false);
  assertEquals(client.includes("return payload.data"), true);
});

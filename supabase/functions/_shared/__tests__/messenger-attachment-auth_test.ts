/// <reference lib="deno.ns" />

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  canActorAccessMessengerAttachmentBatch,
  type MessengerAttachmentActor,
  resolveMessengerAttachmentActor,
} from "../messenger-attachment-auth.ts";
import { createAppSessionToken } from "../request-board-auth.ts";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: Row | null };

const SERVICE_KEY = "test-service-role-key-with-sufficient-length";
const FC_ID = "00000000-0000-4000-8000-000000001001";
const OTHER_FC_ID = "00000000-0000-4000-8000-000000001002";
const ADMIN_ID = "00000000-0000-4000-8000-000000002001";
const OTHER_ADMIN_ID = "00000000-0000-4000-8000-000000002002";
const DEVELOPER_ID = "00000000-0000-4000-8000-000000002003";
const MANAGER_ID = "00000000-0000-4000-8000-000000003001";
const BATCH_ID = "00000000-0000-4000-8000-000000004001";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000005001";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-000000005002";
const THREAD_ID = "00000000-0000-4000-8000-000000005101";
const OTHER_THREAD_ID = "00000000-0000-4000-8000-000000005102";
const ROOM_ID = "00000000-0000-4000-8000-000000006001";

function matches(
  row: Row,
  filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }>,
) {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    return Array.isArray(filter.value) &&
      filter.value.includes(row[filter.column]);
  });
}

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<{
    kind: "eq" | "in";
    column: string;
    value: unknown;
  }> = [];

  constructor(
    private readonly owner: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  limit(_value: number) {
    return this;
  }

  private result(): QueryResult {
    if (this.owner.errors[this.table]) {
      return { data: null, error: this.owner.errors[this.table]! };
    }
    return {
      data: (this.owner.rows[this.table] ?? []).filter((row) =>
        matches(row, this.filters)
      ),
      error: null,
    };
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = this.result();
    const rows = Array.isArray(result.data) ? result.data : [];
    return { ...result, data: rows[0] ?? null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly rows: Record<string, Row[]> = {};
  readonly errors: Record<string, Row | undefined> = {};

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

function asClient(fake: FakeSupabase): never {
  return fake as never;
}

function trustedRequest(serviceKey = SERVICE_KEY): Request {
  return new Request("https://edge.invalid/messenger-attachments", {
    method: "POST",
    headers: { apikey: serviceKey },
  });
}

function appSessionProxyRequest(token: string): Request {
  return new Request("https://edge.invalid/messenger-attachments", {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-app-session-token": token,
    },
  });
}

function batchRow(overrides: Row): Row {
  return {
    id: BATCH_ID,
    actor_id: ADMIN_ID,
    actor_role: "admin",
    context_kind: "direct",
    conversation_id: CONVERSATION_ID,
    room_id: null,
    conversation_ids: null,
    status: "committed",
    ...overrides,
  };
}

const fcActor: MessengerAttachmentActor = {
  id: FC_ID,
  role: "fc",
  phone: "01011112222",
  displayName: "FC",
};
const adminActor: MessengerAttachmentActor = {
  id: ADMIN_ID,
  role: "admin",
  phone: "01033334444",
  displayName: "관리자",
};
const managerActor: MessengerAttachmentActor = {
  id: MANAGER_ID,
  role: "manager",
  phone: "01055556666",
  displayName: "본부장",
};
const developerActor: MessengerAttachmentActor = {
  id: DEVELOPER_ID,
  role: "admin",
  phone: "01077778888",
  displayName: "개발자",
};

Deno.test("trusted service authentication re-resolves an active immutable FC actor", async () => {
  const fake = new FakeSupabase();
  fake.rows.fc_profiles = [{
    id: FC_ID,
    name: "김가람",
    phone: "010-1111-2222",
    signup_completed: true,
    is_manager_referral_shadow: false,
    affiliation: "1본부",
  }];
  const result = await resolveMessengerAttachmentActor({
    req: trustedRequest(),
    body: {
      viewer_actor_id: FC_ID,
      viewer_actor_phone: "01011112222",
      viewer_actor_role: "fc",
    },
    supabase: asClient(fake),
    serviceKey: SERVICE_KEY,
  });
  assertEquals(result, {
    ok: true,
    actor: {
      id: FC_ID,
      role: "fc",
      phone: "01011112222",
      displayName: "김가람",
    },
    trustedService: true,
  });
});

Deno.test("an explicit app session takes precedence over the proxy service key", async () => {
  const secretName = "FC_APP_SESSION_TOKEN_SECRET";
  const previousSecret = Deno.env.get(secretName);
  Deno.env.set(secretName, "attachment-app-session-test-secret-32-bytes");
  try {
    const token = await createAppSessionToken(
      "01011112222",
      "fc",
      undefined,
      FC_ID,
    );
    if (!token) throw new Error("app session token was not created");

    const fake = new FakeSupabase();
    fake.rows.fc_profiles = [{
      id: FC_ID,
      name: "FC",
      phone: "01011112222",
      signup_completed: true,
      is_manager_referral_shadow: false,
      affiliation: "1본부",
    }];
    const result = await resolveMessengerAttachmentActor({
      req: appSessionProxyRequest(token),
      body: {
        viewer_actor_id: OTHER_ADMIN_ID,
        viewer_actor_phone: "01099998888",
        viewer_actor_role: "admin",
      },
      supabase: asClient(fake),
      serviceKey: SERVICE_KEY,
    });
    assertEquals(result, {
      ok: true,
      actor: {
        id: FC_ID,
        role: "fc",
        phone: "01011112222",
        displayName: "FC",
      },
      trustedService: false,
    });

    const invalidSession = await resolveMessengerAttachmentActor({
      req: appSessionProxyRequest("not-a-signed-app-session"),
      body: {
        viewer_actor_id: FC_ID,
        viewer_actor_phone: "01011112222",
        viewer_actor_role: "fc",
      },
      supabase: asClient(fake),
      serviceKey: SERVICE_KEY,
    });
    assertEquals(invalidSession.ok, false);
    if (invalidSession.ok === false) {
      assertEquals(invalidSession.code, "invalid_app_session");
      assertEquals(invalidSession.status, 401);
    }
  } finally {
    if (previousSecret === undefined) {
      Deno.env.delete(secretName);
    } else {
      Deno.env.set(secretName, previousSecret);
    }
  }
});

Deno.test("FC shadows, embedded designers and inactive or phone-mismatched actors fail closed", async () => {
  const vectors: Array<Row> = [
    {
      id: FC_ID,
      name: "shadow",
      phone: "01011112222",
      signup_completed: true,
      is_manager_referral_shadow: true,
      affiliation: "1본부",
    },
    {
      id: FC_ID,
      name: "designer",
      phone: "01011112222",
      signup_completed: true,
      is_manager_referral_shadow: false,
      affiliation: "request_board_designer:manager",
    },
    {
      id: FC_ID,
      name: "legacy designer",
      phone: "01011112222",
      signup_completed: true,
      is_manager_referral_shadow: false,
      affiliation: "외부 설계 매니저",
    },
    {
      id: FC_ID,
      name: "incomplete",
      phone: "01011112222",
      signup_completed: false,
      is_manager_referral_shadow: false,
      affiliation: "1본부",
    },
    {
      id: FC_ID,
      name: "wrong phone",
      phone: "01099998888",
      signup_completed: true,
      is_manager_referral_shadow: false,
      affiliation: "1본부",
    },
  ];
  for (const row of vectors) {
    const fake = new FakeSupabase();
    fake.rows.fc_profiles = [row];
    const result = await resolveMessengerAttachmentActor({
      req: trustedRequest(),
      body: {
        viewer_actor_id: FC_ID,
        viewer_actor_phone: "01011112222",
        viewer_actor_role: "fc",
      },
      supabase: asClient(fake),
      serviceKey: SERVICE_KEY,
    });
    assertEquals(result.ok, false);
    if (result.ok !== false) continue;
    assertEquals(result.code, "forbidden");
    assertEquals(result.status, 403);
  }
});

Deno.test("manager/admin/developer identities are active, typed and service-bound", async () => {
  const managerDb = new FakeSupabase();
  managerDb.rows.manager_accounts = [{
    id: MANAGER_ID,
    name: "본부장",
    phone: "01055556666",
    active: true,
  }];
  const managerResult = await resolveMessengerAttachmentActor({
    req: trustedRequest(),
    body: {
      viewer_actor_id: MANAGER_ID,
      viewer_actor_phone: "01055556666",
      viewer_actor_role: "manager",
    },
    supabase: asClient(managerDb),
    serviceKey: SERVICE_KEY,
  });
  assertEquals(managerResult.ok && managerResult.actor.role, "manager");
  assertEquals(managerResult.ok && managerResult.trustedService, true);
  const forgedManagerAlias = await resolveMessengerAttachmentActor({
    req: trustedRequest(),
    body: {
      viewer_actor_id: MANAGER_ID,
      viewer_actor_phone: "01055556666",
      viewer_actor_role: "admin",
    },
    supabase: asClient(managerDb),
    serviceKey: SERVICE_KEY,
  });
  assertEquals(forgedManagerAlias.ok, false);

  for (const requestedRole of ["admin", "developer"] as const) {
    const adminDb = new FakeSupabase();
    adminDb.rows.admin_accounts = [{
      id: ADMIN_ID,
      name: requestedRole,
      phone: "01033334444",
      active: true,
      staff_type: requestedRole,
    }];
    const result = await resolveMessengerAttachmentActor({
      req: trustedRequest(),
      body: {
        viewer_actor_id: ADMIN_ID,
        viewer_actor_phone: "01033334444",
        viewer_actor_role: requestedRole,
      },
      supabase: asClient(adminDb),
      serviceKey: SERVICE_KEY,
    });
    assertEquals(result.ok, true);
    if (!result.ok) continue;
    assertEquals(result.actor.role, "admin");
    assertEquals(result.trustedService, true);
  }

  const mismatchedDeveloper = new FakeSupabase();
  mismatchedDeveloper.rows.admin_accounts = [{
    id: ADMIN_ID,
    name: "ordinary admin",
    phone: "01033334444",
    active: true,
    staff_type: "admin",
  }];
  const rejected = await resolveMessengerAttachmentActor({
    req: trustedRequest(),
    body: {
      viewer_actor_id: ADMIN_ID,
      viewer_actor_phone: "01033334444",
      viewer_actor_role: "developer",
    },
    supabase: asClient(mismatchedDeveloper),
    serviceKey: SERVICE_KEY,
  });
  assertEquals(rejected.ok, false);
  if (rejected.ok === false) {
    assertEquals(rejected.code, "forbidden");
    assertEquals(rejected.status, 403);
  }
});

Deno.test("direct attachment access follows the exact target thread", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_delivery_batches = [batchRow({
    context_kind: "direct",
    conversation_id: CONVERSATION_ID,
  })];
  fake.rows.messages = [{
    attachment_batch_id: BATCH_ID,
    thread_id: THREAD_ID,
    sender_actor_id: FC_ID,
    receiver_actor_id: null,
    deleted_at: null,
  }];
  fake.rows.garamin_direct_threads = [{
    id: THREAD_ID,
    counterparty_role: "admin",
    counterparty_actor_id: null,
  }];
  fake.rows.admin_accounts = [{
    id: ADMIN_ID,
    staff_type: "admin",
    active: true,
  }];

  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: adminActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: fcActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: { ...fcActor, id: OTHER_FC_ID },
      batchId: BATCH_ID,
    }),
    false,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: managerActor,
      batchId: BATCH_ID,
    }),
    false,
  );
});

Deno.test("group access requires a committed batch and active room for FC viewers", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_delivery_batches = [batchRow({
    context_kind: "group",
    conversation_id: null,
    room_id: ROOM_ID,
  })];
  fake.rows.group_chat_rooms = [{ id: ROOM_ID, is_active: true }];

  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: fcActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: managerActor,
      batchId: BATCH_ID,
    }),
    true,
  );

  fake.rows.group_chat_rooms = [{ id: ROOM_ID, is_active: false }];
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: fcActor,
      batchId: BATCH_ID,
    }),
    false,
  );

  fake.rows.messenger_attachment_delivery_batches[0]!.status = "deleted";
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: adminActor,
      batchId: BATCH_ID,
    }),
    false,
  );
});

Deno.test("developer attachment access is bound to the exact developer thread", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_delivery_batches = [batchRow({
    context_kind: "direct",
    conversation_id: CONVERSATION_ID,
  })];
  fake.rows.messages = [{
    attachment_batch_id: BATCH_ID,
    thread_id: THREAD_ID,
    sender_actor_id: FC_ID,
    receiver_actor_id: DEVELOPER_ID,
    deleted_at: null,
  }];
  fake.rows.garamin_direct_threads = [{
    id: THREAD_ID,
    counterparty_role: "developer",
    counterparty_actor_id: DEVELOPER_ID,
  }];
  fake.rows.admin_accounts = [
    { id: DEVELOPER_ID, staff_type: "developer", active: true },
    { id: ADMIN_ID, staff_type: "admin", active: true },
  ];

  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: developerActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: adminActor,
      batchId: BATCH_ID,
    }),
    false,
  );
});

Deno.test("broadcast access follows its exact shared-admin threads and included FCs", async () => {
  const fake = new FakeSupabase();
  fake.rows.messenger_attachment_delivery_batches = [batchRow({
    actor_id: ADMIN_ID,
    context_kind: "direct_broadcast",
    conversation_id: null,
    conversation_ids: [CONVERSATION_ID, OTHER_CONVERSATION_ID],
  })];
  fake.rows.messages = [
    {
      attachment_batch_id: BATCH_ID,
      thread_id: THREAD_ID,
      sender_actor_id: ADMIN_ID,
      receiver_actor_id: FC_ID,
      deleted_at: null,
    },
    {
      attachment_batch_id: BATCH_ID,
      thread_id: OTHER_THREAD_ID,
      sender_actor_id: ADMIN_ID,
      receiver_actor_id: OTHER_FC_ID,
      deleted_at: null,
    },
  ];
  fake.rows.garamin_direct_threads = [
    {
      id: THREAD_ID,
      counterparty_role: "admin",
      counterparty_actor_id: null,
    },
    {
      id: OTHER_THREAD_ID,
      counterparty_role: "admin",
      counterparty_actor_id: null,
    },
  ];
  fake.rows.admin_accounts = [
    { id: ADMIN_ID, staff_type: "admin", active: true },
    { id: OTHER_ADMIN_ID, staff_type: "admin", active: true },
  ];

  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: adminActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: { ...adminActor, id: OTHER_ADMIN_ID },
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: fcActor,
      batchId: BATCH_ID,
    }),
    true,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: {
        ...fcActor,
        id: "00000000-0000-4000-8000-000000001099",
      },
      batchId: BATCH_ID,
    }),
    false,
  );
  assertEquals(
    await canActorAccessMessengerAttachmentBatch({
      supabase: asClient(fake),
      actor: managerActor,
      batchId: BATCH_ID,
    }),
    false,
  );
});

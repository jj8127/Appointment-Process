import { readFileSync } from "fs";
import { join } from "path";

const edgePath = join(
  process.cwd(),
  "supabase",
  "functions",
  "group-chat",
  "index.ts",
);
const helperPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "group-chat-search.ts",
);

function functionSlice(source: string, startName: string, endName: string) {
  const start = source.indexOf(startName);
  const end = source.indexOf(endName, start + startName.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("messenger group search Edge authorization and read-only boundary", () => {
  const source = readFileSync(edgePath, "utf8");
  const helper = readFileSync(helperPath, "utf8");

  test("requires the signed app session and resolved eligible actor before either action", () => {
    const serve = source.slice(source.indexOf("serve(async"));
    const requireSession = serve.indexOf("requireAppSessionFromRequest(req)");
    const resolveActor = serve.indexOf(
      "resolveActor(sessionResult.session, origin)",
    );
    const searchDispatch = serve.indexOf(
      "payload.type === 'group_chat_search'",
    );
    const contextDispatch = serve.indexOf(
      "payload.type === 'group_chat_context'",
    );
    expect(requireSession).toBeGreaterThanOrEqual(0);
    expect(resolveActor).toBeGreaterThan(requireSession);
    expect(searchDispatch).toBeGreaterThan(resolveActor);
    expect(contextDispatch).toBeGreaterThan(resolveActor);

    const actorResolver = functionSlice(
      source,
      "async function resolveActor",
      "async function listEligibleMembers",
    );
    expect(actorResolver).toContain("getFcActorBlockReason(profile, phone)");
    expect(actorResolver).toContain(".from('manager_accounts')");
    expect(actorResolver).toContain(".eq('phone', phone)");
    expect(actorResolver).toContain("if (!data?.active)");
    expect(actorResolver).toContain("isEligibleGroupChatMember");
    expect(source).toContain(
      "isRequestBoardDesignerAffiliation(profile.affiliation)",
    );
  });

  test("authorizes only the existing active canonical room and fails foreign rooms closed", () => {
    const roomAuth = functionSlice(
      source,
      "async function findExistingActiveSearchRoom",
      "function inaccessibleSearchRoomResponse",
    );
    expect(roomAuth).toContain(".from('group_chat_rooms')");
    expect(roomAuth).toContain(".eq('slug', GROUP_CHAT_ROOM_SLUG)");
    expect(roomAuth).toContain(
      "requestedRoomId && room.id !== requestedRoomId",
    );
    expect(roomAuth).toContain("if (!room.is_active)");
    expect(roomAuth).not.toContain(".insert(");
    expect(roomAuth).not.toContain("ensureRoom(");
  });

  test("searches only live content with literal wildcard escaping and stable tuple order", () => {
    const search = functionSlice(
      source,
      "async function handleSearch",
      "async function handleContext",
    );
    expect(search).toContain(".from('group_chat_messages')");
    expect(search).toContain(".is('deleted_at', null)");
    expect(search).toContain(".ilike('content', literalPattern)");
    expect(search).toContain(".order('created_at', { ascending: false })");
    expect(search).toContain(".order('id', { ascending: false })");
    expect(search).toContain("coverage: 'bounded_first_page'");
    expect(search).toContain("nextCursor: null");
    expect(helper).toContain("value.replace(/[\\\\%_]/gu");
    expect(helper).toContain('source: "garamin_group"');
    expect(helper).toContain('kind: "group_chat"');
  });

  test("reauthorizes a non-deleted anchor and returns at most 20+anchor+20 oldest-first", () => {
    const context = functionSlice(
      source,
      "async function handleContext",
      "async function attachmentMapForMessages",
    );
    expect(context).toContain("findExistingActiveSearchRoom(roomId)");
    expect(context).toContain(".eq('id', messageId)");
    expect(context).toContain(".is('deleted_at', null)");
    expect(context).toContain("GROUP_CHAT_CONTEXT_SIDE_LIMIT + 1");
    expect(context).toContain(".order('created_at', { ascending: false })");
    expect(context).toContain(".order('created_at', { ascending: true })");
    expect(context).toContain(
      ".slice(0, GROUP_CHAT_CONTEXT_SIDE_LIMIT).reverse()",
    );
    expect(context).toContain(
      "hasBefore: beforeCandidates.length > GROUP_CHAT_CONTEXT_SIDE_LIMIT",
    );
    expect(context).toContain(
      "hasAfter: afterCandidates.length > GROUP_CHAT_CONTEXT_SIDE_LIMIT",
    );
  });

  test("neither action mutates read receipts, messages, preferences, or logs search data", () => {
    const search = functionSlice(
      source,
      "async function handleSearch",
      "async function handleContext",
    );
    const context = functionSlice(
      source,
      "async function handleContext",
      "async function attachmentMapForMessages",
    );
    for (const action of [search, context]) {
      expect(action).not.toContain("upsertRead(");
      expect(action).not.toContain(".insert(");
      expect(action).not.toContain(".upsert(");
      expect(action).not.toContain(".update(");
      expect(action).not.toContain(".delete(");
      expect(action).not.toContain("console.");
      expect(action).not.toContain(".from('group_chat_reads')");
      expect(action).not.toContain(".from('group_chat_preferences')");
    }
  });
});

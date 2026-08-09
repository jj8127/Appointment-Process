import {
  buildGroupChatContextBody,
  buildGroupChatSearchBody,
  groupChatContext,
  groupChatSearch,
  parseGroupChatContextResponse,
  parseGroupChatSearchResponse,
} from "../group-chat-api";
import { getStoredAppSessionToken } from "../request-board-api";
import { supabase } from "../supabase";

jest.mock("../request-board-api", () => ({
  getStoredAppSessionToken: jest.fn(),
}));

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const ROOM_ID = "22222222-2222-4222-8222-222222222222";

function messageResult(index: number, sentAt: string) {
  const messageId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    source: "garamin_group" as const,
    ref: { version: 1 as const, kind: "group_chat" as const, roomId: ROOM_ID },
    messageId,
    sentAt,
    excerpt: `메시지 ${index}`,
    roomLabel: "가라민 단톡방",
    senderLabel: "홍길동",
  };
}

function contextMessage(index: number, createdAt: string) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    room_id: ROOM_ID,
    sender_actor_id: "fc:01012345678",
    sender_role: "fc" as const,
    sender_phone: "01012345678",
    sender_name: "홍길동",
    content: `메시지 ${index}`,
    message_type: "text" as const,
    file_url: null,
    file_name: null,
    file_size: null,
    attachments: [],
    created_at: createdAt,
    unread_count: 0,
    reply_to_message_id: null,
    reply_to_sender_name: null,
    reply_to_content: null,
    deleted_at: null,
    deleted_by_actor_id: null,
    reactions: [],
  };
}

describe("messenger group search mobile contract", () => {
  beforeEach(() => jest.clearAllMocks());

  test("validates Unicode query length, literal wildcard input, and limit", () => {
    expect(() => buildGroupChatSearchBody("가")).toThrow();
    expect(() => buildGroupChatSearchBody("가".repeat(101))).toThrow();
    expect(buildGroupChatSearchBody("%_", 1)).toEqual({
      type: "group_chat_search",
      q: "%_",
      limit: 1,
    });
    expect(() => buildGroupChatSearchBody("보험", 0)).toThrow();
    expect(() => buildGroupChatSearchBody("보험", 51)).toThrow();
    expect(() => buildGroupChatSearchBody("보험", 1.5)).toThrow();
  });

  test("builds context with only canonical identifiers", () => {
    expect(
      buildGroupChatContextBody(
        ROOM_ID.toUpperCase(),
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toEqual({
      type: "group_chat_context",
      room_id: ROOM_ID,
      message_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(() => buildGroupChatContextBody("foreign", "message")).toThrow();
  });

  test("strictly parses bounded, newest-first search results and exact source contract", () => {
    const newer = messageResult(2, "2026-08-04T00:00:02.000Z");
    const older = messageResult(1, "2026-08-04T00:00:01.000Z");
    expect(
      parseGroupChatSearchResponse({
        ok: true,
        results: [newer, older],
        coverage: "bounded_first_page",
        nextCursor: null,
      }),
    ).toEqual({
      results: [newer, older],
      coverage: "bounded_first_page",
      nextCursor: null,
    });

    expect(() =>
      parseGroupChatSearchResponse({
        ok: true,
        results: [{ ...newer, source: "group" }],
        coverage: "bounded_first_page",
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseGroupChatSearchResponse({
        ok: true,
        results: [older, newer],
        coverage: "bounded_first_page",
        nextCursor: null,
      }),
    ).toThrow();
  });

  test("strictly enforces context bound, anchor, room, and oldest-first order", () => {
    const messages = Array.from({ length: 41 }, (_, index) =>
      contextMessage(
        index + 1,
        new Date(Date.UTC(2026, 7, 4, 0, 0, index)).toISOString(),
      ),
    );
    const anchorMessageId = messages[20].id;
    expect(
      parseGroupChatContextResponse({
        ok: true,
        roomRef: { version: 1, kind: "group_chat", roomId: ROOM_ID },
        anchorMessageId,
        messages,
        hasBefore: true,
        hasAfter: true,
        nextCursor: null,
      }),
    ).toMatchObject({
      anchorMessageId,
      messages,
      hasBefore: true,
      hasAfter: true,
      nextCursor: null,
    });

    expect(() =>
      parseGroupChatContextResponse({
        ok: true,
        roomRef: { version: 1, kind: "group_chat", roomId: ROOM_ID },
        anchorMessageId,
        messages: [...messages].reverse(),
        hasBefore: true,
        hasAfter: true,
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseGroupChatContextResponse({
        ok: true,
        roomRef: { version: 1, kind: "group_chat", roomId: ROOM_ID },
        anchorMessageId,
        messages: [...messages, contextMessage(42, "2026-08-04T00:00:42.000Z")],
        hasBefore: true,
        hasAfter: true,
        nextCursor: null,
      }),
    ).toThrow();
  });

  test("invokes both read-only actions with the signed app session only", async () => {
    const searchResponse = {
      ok: true,
      results: [messageResult(1, "2026-08-04T00:00:01.000Z")],
      coverage: "bounded_first_page",
      nextCursor: null,
    };
    const contextResponse = {
      ok: true,
      roomRef: { version: 1, kind: "group_chat", roomId: ROOM_ID },
      anchorMessageId: searchResponse.results[0].messageId,
      messages: [contextMessage(1, "2026-08-04T00:00:01.000Z")],
      hasBefore: false,
      hasAfter: false,
      nextCursor: null,
    };
    (getStoredAppSessionToken as jest.Mock).mockResolvedValue(
      "signed-app-session",
    );
    (supabase.functions.invoke as jest.Mock)
      .mockResolvedValueOnce({ data: searchResponse, error: null })
      .mockResolvedValueOnce({ data: contextResponse, error: null });

    await groupChatSearch("보험", 10);
    await groupChatContext(ROOM_ID, searchResponse.results[0].messageId);

    expect(supabase.functions.invoke).toHaveBeenNthCalledWith(1, "group-chat", {
      body: { type: "group_chat_search", q: "보험", limit: 10 },
      headers: { "x-app-session-token": "signed-app-session" },
    });
    expect(supabase.functions.invoke).toHaveBeenNthCalledWith(2, "group-chat", {
      body: {
        type: "group_chat_context",
        room_id: ROOM_ID,
        message_id: searchResponse.results[0].messageId,
      },
      headers: { "x-app-session-token": "signed-app-session" },
    });
  });
});

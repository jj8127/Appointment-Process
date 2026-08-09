import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildGroupChatSearchExcerpt,
  escapeGroupChatIlikeLiteral,
  normalizeGroupChatSearchLimit,
  normalizeGroupChatSearchQuery,
  serializeGroupChatSearchResult,
} from "../group-chat-search.ts";

Deno.test("messenger group search enforces Unicode query and limit bounds", () => {
  assertEquals(normalizeGroupChatSearchQuery("가"), null);
  assertEquals(normalizeGroupChatSearchQuery("가".repeat(101)), null);
  assertEquals(normalizeGroupChatSearchQuery("  보험   검토  "), "보험 검토");
  assertEquals(normalizeGroupChatSearchQuery("😀😀"), "😀😀");

  assertEquals(normalizeGroupChatSearchLimit(undefined), 50);
  assertEquals(normalizeGroupChatSearchLimit(1), 1);
  assertEquals(normalizeGroupChatSearchLimit(50), 50);
  assertEquals(normalizeGroupChatSearchLimit(0), null);
  assertEquals(normalizeGroupChatSearchLimit(51), null);
  assertEquals(normalizeGroupChatSearchLimit(1.5), null);
  assertEquals(normalizeGroupChatSearchLimit("10"), null);
});

Deno.test("messenger group search treats LIKE wildcards as literal text", () => {
  assertEquals(escapeGroupChatIlikeLiteral("%_"), "\\%\\_");
  assertEquals(escapeGroupChatIlikeLiteral("50%_완료\\"), "50\\%\\_완료\\\\");
});

Deno.test("messenger group search excerpts are bounded by Unicode code points", () => {
  const content = `${"앞".repeat(180)}보험검토${"뒤".repeat(180)}`;
  const excerpt = buildGroupChatSearchExcerpt(content, "보험검토");
  assertEquals(Array.from(excerpt).length, 240);
  assertStringIncludes(excerpt, "보험검토");
});

Deno.test("messenger group search emits the exact Garamin source and room ref contract", () => {
  const result = serializeGroupChatSearchResult({
    row: {
      id: "11111111-1111-4111-8111-111111111111",
      room_id: "22222222-2222-4222-8222-222222222222",
      sender_name: "홍길동",
      sender_role: "fc",
      content: "보험 검토가 필요합니다.",
      created_at: "2026-08-04T00:00:00.000Z",
      deleted_at: null,
    },
    query: "보험",
    roomLabel: "가라민 단톡방",
  });

  assertEquals(result.source, "garamin_group");
  assertEquals(result.ref, {
    version: 1,
    kind: "group_chat",
    roomId: "22222222-2222-4222-8222-222222222222",
  });
  assertEquals(result.messageId, "11111111-1111-4111-8111-111111111111");
  assertEquals(result.senderLabel, "홍길동");
});

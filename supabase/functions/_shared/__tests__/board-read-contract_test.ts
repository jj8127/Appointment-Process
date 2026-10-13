/// <reference lib="deno.ns" />

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasUniqueStringField,
  isBoardAttachmentQueryRow,
  isBoardCategoryQueryRow,
  isBoardListQueryRow,
  isBoardUuid,
} from "../board-read-contract.ts";

const category = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "공지",
  slug: "notice",
  sort_order: 1,
  is_active: true,
};

const post = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "제목",
  content: "본문",
  author_name: "작성자",
  author_role: "admin",
  author_resident_id: "01012345678",
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
  edited_at: null,
  is_pinned: false,
  pinned_at: null,
  comment_count: 0,
  reaction_count: 0,
  attachment_count: 0,
  view_count: 1,
};

Deno.test("board read guards reject malformed category, post, and attachment rows", () => {
  assertEquals(isBoardUuid(category.id), true);
  assertEquals(isBoardUuid("not-a-uuid"), false);
  assertEquals(isBoardCategoryQueryRow(category), true);
  assertEquals(
    isBoardCategoryQueryRow({ ...category, id: "not-a-uuid" }),
    false,
  );
  assertEquals(isBoardListQueryRow(post), true);
  assertEquals(isBoardListQueryRow({ ...post, comment_count: null }), false);
  assertEquals(
    isBoardAttachmentQueryRow({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      post_id: post.id,
      file_type: "image",
      file_name: "image.png",
      file_size: 12,
      storage_path: "board/image.png",
      sort_order: 0,
    }),
    true,
  );
});

Deno.test("board read guards reject duplicate identifiers", () => {
  assertEquals(hasUniqueStringField([category], "id"), true);
  assertEquals(hasUniqueStringField([category, { ...category }], "id"), false);
});

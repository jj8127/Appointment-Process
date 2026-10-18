/// <reference lib="deno.ns" />

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseQueryCount, parseQueryRows } from "../query-result-contract.ts";

const isIdRow = (value: unknown): value is { id: string } => (
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>).id === "string"
);

Deno.test("query row contracts distinguish valid empty arrays from malformed success payloads", () => {
  assertEquals(parseQueryRows([], isIdRow), []);
  assertEquals(parseQueryRows([{ id: "row-1" }], isIdRow), [{ id: "row-1" }]);
  assertEquals(parseQueryRows(null, isIdRow), null);
  assertEquals(parseQueryRows([{ id: 1 }], isIdRow), null);
});

Deno.test("query count contract accepts only non-negative safe integers", () => {
  assertEquals(parseQueryCount(0), 0);
  assertEquals(parseQueryCount(12), 12);
  assertEquals(parseQueryCount(null), null);
  assertEquals(parseQueryCount(-1), null);
  assertEquals(parseQueryCount(1.5), null);
});

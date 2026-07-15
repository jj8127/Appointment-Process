#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AGENTS_MAX_BYTES = 24 * 1024;

export function evaluateAgentsByteLength(byteLength, maxBytes = AGENTS_MAX_BYTES) {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new TypeError('byteLength must be a non-negative integer');
  }

  return {
    ok: byteLength <= maxBytes,
    byteLength,
    maxBytes,
    excessBytes: Math.max(0, byteLength - maxBytes),
  };
}

export function evaluateAgentsContent(content, maxBytes = AGENTS_MAX_BYTES) {
  const byteLength = Buffer.isBuffer(content)
    ? content.byteLength
    : Buffer.byteLength(String(content), 'utf8');
  return evaluateAgentsByteLength(byteLength, maxBytes);
}

export function checkAgentsFile(filePath = 'AGENTS.md', maxBytes = AGENTS_MAX_BYTES) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      filePath: resolved,
      byteLength: 0,
      maxBytes,
      excessBytes: 0,
      error: `Missing required control document: ${filePath}`,
    };
  }

  const result = evaluateAgentsContent(fs.readFileSync(resolved), maxBytes);
  return {
    ...result,
    filePath: resolved,
    error: result.ok
      ? null
      : `AGENTS.md size policy violation: ${result.byteLength} bytes exceeds ${result.maxBytes} bytes by ${result.excessBytes}. Move status/history to handbook or work logs.`,
  };
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const filePath = process.argv[2] ?? 'AGENTS.md';
  const result = checkAgentsFile(filePath);
  if (!result.ok) {
    console.error(`[documentation-governance] failed: ${result.error}`);
    process.exit(1);
  }

  console.log(
    `[documentation-governance] passed: ${filePath} ${result.byteLength}/${result.maxBytes} bytes`
  );
}

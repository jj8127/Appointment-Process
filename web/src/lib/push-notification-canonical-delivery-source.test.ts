import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('push service success follows inbox persistence, not device or provider outcome', () => {
  const source = readSource('lib/push-notification-service.ts');
  assert.match(source, /success:\s*notificationStored/);
  assert.match(source, /warning:\s*notificationStored\s*\?\s*null/);
  assert.match(source, /pushStatus/);
  assert.match(source, /'no_registered_device'/);
  assert.match(source, /'provider_rejected'/);
  assert.doesNotMatch(source, /success:\s*warning === null/);
});

test('admin FC route exposes the canonical delivery and persistence-only warning', () => {
  const source = readSource('app/api/admin/fc/route.ts');
  assert.match(source, /delivery:\s*result\.delivery/);
  assert.match(source, /result\.delivery\.notificationStored/);
  assert.match(source, /notification_persistence_incomplete/);
  assert.doesNotMatch(source, /result\.success \? \{\} : \{ warning/);
});

import { readdirSync } from 'fs';
import path from 'path';
import { sanitizeSentryEvent } from '../sentry-sanitize';
import {
  getSentryScreenName,
  getSentryUpdateTags,
  SENTRY_SCREEN_NAMES,
} from '../sentry-runtime-context';

describe('native crash attribution context', () => {
  it('classifies every current screen using literal route names only', () => {
    function readRoutes(directory: string, prefix = ''): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) return readRoutes(path.join(directory, entry.name), `${name}/`);
        if (!name.endsWith('.tsx') || entry.name === '_layout.tsx') return [];
        const route = name.slice(0, -4);
        return [route === 'index' ? '/' : `/${route}`];
      });
    }
    const routes = readRoutes(path.resolve(__dirname, '../../app'));
    expect([...SENTRY_SCREEN_NAMES].sort()).toEqual(routes.sort());
    for (const route of routes) {
      expect(getSentryScreenName(route.split('/').filter(Boolean))).toBe(route);
    }
  });

  it.each([
    ['group-chat', 'synthetic-record-id'],
    ['group-chat?roomId=synthetic-secret'],
    ['https://example.invalid/login'],
    ['unknown-screen'],
    ['fc', '[id]'],
    ['010-0000-0000'],
  ])('collapses unresolved, parameterized, and unknown routes to one safe value (%j)', (...segments) => {
    expect(getSentryScreenName(segments)).toBe('unknown');
  });

  it('uses only deployed-bundle metadata, including the OTA UUID', () => {
    const result = getSentryUpdateTags({
      runtimeVersion: '4.2.8',
      updateId: '12345678-1234-1234-1234-123456789abc',
      isEmbeddedLaunch: false,
      // Additional SDK metadata must never reach a Sentry tag implicitly.
      manifest: { userId: 'synthetic-private-value' },
    } as Parameters<typeof getSentryUpdateTags>[0]);
    expect(result).toEqual({
      'expo.runtime_version': '4.2.8',
      'expo.update_id': '12345678-1234-1234-1234-123456789abc',
      'expo.embedded_launch': 'false',
    });
  });

  it('does not serialize malformed or absent native update values', () => {
    expect(getSentryUpdateTags({
      runtimeVersion: 'https://example.invalid/?token=synthetic-secret',
      updateId: 'synthetic-record-id',
      isEmbeddedLaunch: { secret: 'synthetic-secret' },
    })).toEqual({
      'expo.runtime_version': 'unknown',
      'expo.update_id': 'unknown',
      'expo.embedded_launch': 'unknown',
    });
    expect(Object.values(getSentryUpdateTags({}))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('preserves allowlisted screen and update context through the production sanitizer', () => {
    const screen = getSentryScreenName(['request-board-fc-codes']);
    const tags = {
      ...getSentryUpdateTags({
        runtimeVersion: '4.2.8',
        updateId: '05021234-5678-1234-1234-123456789abc',
        isEmbeddedLaunch: true,
      }),
      'app.screen': screen,
    };
    const event = {
      tags,
      breadcrumbs: [{ category: 'navigation', message: 'Screen changed', data: { screen } }],
    };
    expect(sanitizeSentryEvent(event)).toEqual(event);
    expect(sanitizeSentryEvent({ tags: { 'expo.update_id': '010-1234-5678' } })).toEqual({
      tags: { 'expo.update_id': '010-****-5678' },
    });
  });
});

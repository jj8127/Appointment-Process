import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createHomeRealtimeChannelTopic } from '../home-realtime-channel';

describe('home realtime channel topics', () => {
  it('creates a unique, non-identifying topic for every effect setup', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);

    const first = createHomeRealtimeChannelTopic('home-messages');
    const second = createHomeRealtimeChannelTopic('home-messages');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^home-messages-[a-z0-9]+-[a-z0-9]+$/);
    expect(second).toMatch(/^home-messages-[a-z0-9]+-[a-z0-9]+$/);

    now.mockRestore();
  });

  it('keeps FC identifiers out of home channel topic construction', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'index.tsx'), 'utf8');

    expect(source).not.toContain("createHomeRealtimeChannelTopic('home-messages')");
    expect(source).toContain("createHomeRealtimeChannelTopic('home-profile')");
    expect(source).toContain("createHomeRealtimeChannelTopic('home-documents')");
    expect(source).not.toContain('.channel(`home-messages-${residentId}`)');
    expect(source).not.toContain('.channel(`home-profile-${residentId}`)');
    expect(source).not.toContain('.channel(`home-docs-${myFc.id}`)');
  });

  // A stable topic returns an already-subscribed channel on re-entry and `.on()` throws
  // ("cannot add postgres_changes callbacks ... after subscribe()"), crashing the screen.
  it('gives every app Realtime subscription its own instance topic', () => {
    const appDir = join(process.cwd(), 'app');
    const sources = readdirSync(appDir, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'))
      .map((file) => [file, readFileSync(join(appDir, file), 'utf8')] as const)
      .filter(([, source]) => source.includes('.channel('));
    expect(sources.map(([file]) => file)).toEqual(expect.arrayContaining(['group-chat.tsx', 'dashboard.tsx']));
    for (const [file, source] of sources) {
      const topics = [...source.matchAll(/\.channel\(([^\n]*)/g)].map((match) => match[1]);
      for (const topic of topics) {
        expect([file, /^create(?:Home|ExamApply)?RealtimeChannelTopic\(/.test(topic)]).toEqual([file, true]);
      }
    }
  });

  it('loads latest direct messages through the service and polls without messages Realtime', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'index.tsx'), 'utf8');

    expect(source).toContain('resolveGaraminDirectConversation({');
    expect(source).toContain('fetchGaraminDirectMessages(conversation.id)');
    expect(source).toContain('const intervalId = setInterval(');
    expect(source).not.toMatch(/\.from\(\s*['"]messages['"]\s*\)/);
    expect(source).not.toMatch(/table:\s*['"]messages['"]/);
  });
});

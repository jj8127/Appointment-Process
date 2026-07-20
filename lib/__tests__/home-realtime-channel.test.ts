import { readFileSync } from 'node:fs';
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

    expect(source).toContain("createHomeRealtimeChannelTopic('home-messages')");
    expect(source).toContain("createHomeRealtimeChannelTopic('home-profile')");
    expect(source).toContain("createHomeRealtimeChannelTopic('home-documents')");
    expect(source).not.toContain('.channel(`home-messages-${residentId}`)');
    expect(source).not.toContain('.channel(`home-profile-${residentId}`)');
    expect(source).not.toContain('.channel(`home-docs-${myFc.id}`)');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const functionRoot = join(__dirname, '..', '..', 'supabase', 'functions');

function readFunctionFile(fileName: string) {
  return readFileSync(join(functionRoot, fileName), 'utf8');
}

describe('group chat edge notification fanout', () => {
  it('filters request-board designer device tokens from group chat push', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain('filterManagerTokensForNotification');
    expect(source).toContain("category: GROUP_CHAT_NOTIFICATION_CATEGORY");
    expect(source).toContain("select('expo_push_token,resident_id,role')");
  });

  it('uses high priority Expo push payloads for group chat messages', () => {
    const source = readFunctionFile('group-chat/index.ts');

    expect(source).toContain("priority: 'high'");
    expect(source).toContain("channelId: 'alerts'");
  });
});

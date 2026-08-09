import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildFcTargetRows } from '../messenger-hub-model';
import {
  formatManagerMessengerDetail,
  getManagerHeadquartersLabels,
} from '../messenger-participants';

const read = (relativePath: string) =>
  readFileSync(join(__dirname, '..', '..', relativePath), 'utf8');

describe('manager headquarters labels in Messenger', () => {
  test('normalizes canonical and legacy team labels without guessing an unmapped manager', () => {
    expect(formatManagerMessengerDetail('7본부 이동훈')).toBe('7본부 본부장');
    expect(formatManagerMessengerDetail('10팀(직할) : 한태균 본부장님')).toBe('10본부 본부장');
    expect(getManagerHeadquartersLabels('2본부 박성훈 · 6팀(전주1) : 박선희 본부장님'))
      .toEqual(['2본부', '6본부']);
    expect(formatManagerMessengerDetail('본부 정보 없음')).toBe('본부장');
    expect(formatManagerMessengerDetail(null)).toBe('본부장');
  });

  test('renders the mapped headquarters while preserving exact manager routing identity', () => {
    const result = buildFcTargetRows({
      managers: [{
        name: '이동훈',
        phone: '010-1111-2222',
        affiliation: '7본부 이동훈',
        conversation_id: '11111111-1111-4111-8111-111111111111',
        unread_count: 0,
      }],
      developers: [],
      admins: [],
      adminUnreadCount: 0,
    });

    expect(result.people[0]).toMatchObject({
      name: '이동훈',
      detail: '7본부 본부장',
      role: 'manager',
      route: {
        kind: 'internal',
        conversationId: '11111111-1111-4111-8111-111111111111',
        targetName: '이동훈',
      },
    });
  });

  test('loads active phone-bound mappings once and uses the shared formatter on FC surfaces', () => {
    const edge = read('supabase/functions/fc-notify/index.ts');
    const legacyChat = read('app/chat.tsx');
    const search = read('app/messenger-search.tsx');

    const chatTargetsStart = edge.indexOf("if (body.type === 'chat_targets')");
    const internalListStart = edge.indexOf("if (body.type === 'internal_chat_list')", chatTargetsStart);
    const chatTargets = edge.slice(chatTargetsStart, internalListStart);

    expect(chatTargets).toContain(".from('affiliation_manager_mappings')");
    expect(chatTargets).toContain(".select('affiliation,manager_phone')");
    expect(chatTargets).toContain(".eq('active', true)");
    expect(chatTargets).toContain('managerAffiliationsByPhone.get(sanitize(manager.phone))');
    expect(legacyChat).toContain('subtitle: formatManagerMessengerDetail(manager.affiliation)');
    expect(search).toContain('formatManagerMessengerDetail(target.affiliation)');
  });
});

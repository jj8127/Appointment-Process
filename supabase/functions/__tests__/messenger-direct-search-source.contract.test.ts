import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Messenger V2 direct search and context Edge contract', () => {
  const edge = read('supabase/functions/fc-notify/index.ts');
  const policy = read('supabase/functions/_shared/fc-notify-auth-policy.ts');
  const helper = read('supabase/functions/_shared/direct-message-search.ts');

  test('binds both actions to the signed actor and rejects malformed input', () => {
    expect(policy).toContain("body.type === 'direct_message_search'");
    expect(policy).toContain("body.type === 'direct_message_context'");
    expect(policy).toContain('normalizeDirectMessageSearchQuery(body.q)');
    expect(policy).toContain('normalizeDirectMessageSearchLimit(body.limit)');
    expect(policy).toContain('viewer_actor_id: actor.actorId');
    expect(policy).not.toContain('viewer_actor_id: body.viewer_actor_id');
    expect(helper).toContain('Array.from(normalized).length');
    expect(helper).toContain('value.replace(/[\\\\%_]/g');
  });

  test('allows one exact FC staff phone for server resolution but no arbitrary account class', () => {
    const resolveStart = policy.indexOf("body.type === 'resolve_garamin_direct_conversation'");
    const directStart = policy.indexOf("body.type === 'direct_message_search'", resolveStart);
    const resolvePolicy = policy.slice(resolveStart, directStart);
    expect(resolvePolicy).toContain('sanitizePhone(rawTarget).length !== 11');
    expect(edge).toContain(".eq('staff_type', 'developer')");
    expect(edge).toContain(".from('manager_accounts')");
    expect(edge).toContain("'Direct conversation target is ambiguous'");
    expect(edge).toContain("'Direct conversation target not found'");
  });

  test('uses canonical threads, active targets, existing visibility rules, and deleted-row denial', () => {
    expect(edge).toContain('existingCanonicalOnly: true');
    expect(edge).toContain('id: thread.id');
    expect(edge).toContain(".eq('signup_completed', true)");
    expect(edge).toContain(".eq('is_manager_referral_shadow', false)");
    expect(edge).toContain('!parseDesignerCompanyNameFromAffiliation(row.affiliation)');
    expect(edge).toContain('resolveActiveDirectCounterparty');
    expect(edge).toContain('canAccessDirectConversation(actor, {');
    expect(edge).toContain('isCurrentDirectMessageVisible({');
    expect(edge).toContain('isLegacyDirectMessageVisible({');
    expect(edge).toContain('if (input.row.deleted_at !== null) return false');
    expect(edge).toContain(".eq('active', true)");
    expect(edge).toContain('return isDirectSearchRowVisible({ ...input, thread: directThread })');
    expect(edge).toContain("return err('Direct message not found', 404)");
  });

  test('search/context branches are read-only and context is bounded around one anchor', () => {
    const searchStart = edge.indexOf("if (body.type === 'direct_message_search')");
    const broadcastStart = edge.indexOf("if (body.type === 'direct_message_broadcast_send')", searchStart);
    const branches = edge.slice(searchStart, broadcastStart);
    const helperStart = edge.indexOf('async function listAccessibleExistingDirectThreads');
    const handlerStart = edge.indexOf('serve(async (req: Request) =>', helperStart);
    const helpers = edge.slice(helperStart, handlerStart);
    expect(branches).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/);
    expect(helpers).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/);
    expect(branches).not.toContain('is_read: true');
    expect(edge).toContain(".limit(20)");
    expect(edge).toContain("direction: 'before'");
    expect(edge).toContain("direction: 'after'");
  });

  test('limits legacy context only after selecting the exact signed endpoint pair', () => {
    const scopeStart = edge.indexOf('function buildContextScopeQuery');
    const scopeEnd = edge.indexOf('async function fetchDirectMessageContextSide', scopeStart);
    const scope = edge.slice(scopeStart, scopeEnd);
    const contextStart = scope.indexOf("if (source === 'current')");
    const legacyPair = scope.indexOf(
      '`and(sender_id.eq.${viewerEndpointId},receiver_id.eq.${counterpartyEndpointId}),`',
      contextStart,
    );

    expect(scope).toContain("actor.sessionRole === 'fc'");
    expect(legacyPair).toBeGreaterThan(contextStart);
    expect(scope).toContain(
      '`and(sender_id.eq.${counterpartyEndpointId},receiver_id.eq.${viewerEndpointId})`',
    );
    expect(scope).not.toContain('.or(`sender_id.eq.${');

    const sideStart = edge.indexOf('async function fetchDirectMessageContextSide');
    const sideEnd = edge.indexOf('serve(async (req: Request) =>', sideStart);
    const side = edge.slice(sideStart, sideEnd);
    expect(side.indexOf('buildContextScopeQuery(input.actor, input.thread, source)'))
      .toBeLessThan(side.indexOf('.limit(20)'));
  });

  test('derives context sender side from the signed actor before legacy endpoint fallback', () => {
    const sideStart = edge.indexOf('function directMessageSenderSide');
    const sideEnd = edge.indexOf('const DIRECT_SEARCH_MESSAGE_COLUMNS', sideStart);
    const side = edge.slice(sideStart, sideEnd);
    const exactSender = side.indexOf('senderActorId === input.actor.actorId');
    const exactReceiver = side.indexOf('receiverActorId === input.actor.actorId');
    const legacyFallback = side.indexOf(
      'const viewerEndpointId = legacySearchActorId(input.actor, input.thread)',
    );

    expect(exactSender).toBeGreaterThanOrEqual(0);
    expect(exactReceiver).toBeGreaterThan(exactSender);
    expect(legacyFallback).toBeGreaterThan(exactReceiver);
    expect(side).toContain("return 'viewer'");
    expect(side).toContain("return 'counterparty'");
    expect(edge).toContain('senderSide,');
    expect(edge).toContain("if (!senderSide) throw new Error('Direct message sender side is invalid');");
  });

  test('internal list returns a paged read RPC with a proven canonical id or exact phone fallback', () => {
    const listStart = edge.indexOf("if (body.type === 'internal_chat_list')");
    const unreadStart = edge.indexOf("if (body.type === 'internal_unread_count')", listStart);
    const listBranch = edge.slice(listStart, unreadStart);
    expect(listBranch).toContain('ids.length === 1 ? ids[0] : null');
    expect(listBranch).toContain('const { data: rawPageRows, error: pageError } = await supabase.rpc(');
    expect(listBranch).toContain("'list_internal_chat_page_v1'");
    expect(listBranch).toContain('conversation_id: canonicalThreadByFcId.get(item.fc_id) ?? null');
    expect(listBranch).toContain('target_id: item.phone');
    expect(listBranch).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });
});

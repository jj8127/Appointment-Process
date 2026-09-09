import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'app/group-chat.tsx'), 'utf8').replace(/\r\n/g, '\n');

function readMillisecondConstant(name: string) {
  const match = source.match(new RegExp(`const ${name} = ([\\d_]+);`));
  if (!match) throw new Error(`Missing ${name}`);
  return Number(match[1].replaceAll('_', ''));
}

describe('group-chat bounded anchor context source contract', () => {
  test('accepts only an exact optional UUID anchor and calls the signed context wrapper', () => {
    expect(source).toContain('roomId, anchorMessageId, notificationId');
    expect(source).toContain('anchorMessageId?: string;');
    expect(source).toContain(
      'const routeAnchorMessageId = parseExactlyOneUuidRouteParam(anchorMessageId)',
    );
    expect(source).toContain(
      'const hasInvalidAnchorRoute =\n    hasAnchorRouteParam && !routeAnchorMessageId',
    );
    expect(source).toContain(
      'await groupChatContext(contextRoomId, routeAnchorMessageId)',
    );
  });

  test('merges authorized context after bootstrap while preserving canonical full rows', () => {
    const loadStart = source.indexOf('const load = useCallback');
    const loadEnd = source.indexOf('useFocusEffect(', loadStart);
    const load = source.slice(loadStart, loadEnd);
    const bootstrap = load.indexOf('await groupChatBootstrap(MESSAGE_LIMIT)');
    const context = load.indexOf(
      'await groupChatContext(contextRoomId, routeAnchorMessageId)',
    );
    const merge = load.indexOf(
      'applyMessages([...data.messages, ...contextMessages, ...localMessages])',
    );
    const markRead = load.indexOf('void groupChatMarkRead(topMessageId)');

    expect(bootstrap).toBeGreaterThanOrEqual(0);
    expect(context).toBeGreaterThan(bootstrap);
    expect(merge).toBeGreaterThan(context);
    expect(markRead).toBeGreaterThan(merge);
    expect(load).toContain(
      'context.roomRef.roomId !== data.room.id',
    );
    expect(load).toContain(
      'context.anchorMessageId !== routeAnchorMessageId',
    );
    expect(load).toContain('contextMessages = context.messages');
    expect(source).not.toContain('contextResultToDisplayMessage');
  });

  test('keeps the signed full-fidelity context rows and does not add anchor-specific read receipts', () => {
    expect(source).toContain('contextMessages = context.messages');
    expect(source).not.toContain('sender_actor_id: `context:${result.messageId}`');
    expect(source).not.toContain('groupChatMarkRead(routeAnchorMessageId)');
    expect(source).not.toContain('groupChatMarkRead(context.anchorMessageId)');
    expect(source).not.toContain('groupChatMarkRead(anchorMessageId)');
  });

  test('revalidates cached context conservatively and coalesces in-flight checks', () => {
    const revalidateMs = readMillisecondConstant(
      'GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS',
    );

    expect(revalidateMs).toBeGreaterThan(0);
    expect(source).not.toContain('GROUP_CHAT_REFRESH_INTERVAL_MS');
    expect(source).not.toContain('setInterval(');
    expect(source).not.toContain('useEffect(() => {\n    void load();');
    expect(source).toContain('useFocusEffect(');
    expect(source).toContain('validatedAt: number;');
    expect(source).toContain(
      'now - cachedContext.validatedAt >= GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS',
    );
    expect(source).toContain(
      'now - anchorContextLastAttemptAtRef.current >= GROUP_CHAT_ANCHOR_CONTEXT_REVALIDATE_MS',
    );
    expect(source).toContain(
      'anchorContextInFlightKeyRef.current !== contextKey',
    );
    expect(source).toContain(
      'anchorContextRequestGenerationRef.current !== requestGeneration',
    );
  });

  test('scrubs stale context and gap state when revalidation loses anchor access', () => {
    const contextCatchStart = source.indexOf(
      "catch {\n            if (anchorContextRequestGenerationRef.current !== requestGeneration) return;",
    );
    const contextCatchEnd = source.indexOf('} finally {', contextCatchStart);
    const contextCatch = source.slice(contextCatchStart, contextCatchEnd);

    expect(contextCatchStart).toBeGreaterThanOrEqual(0);
    expect(contextCatch).toContain('anchorContextRef.current = null');
    expect(contextCatch).toContain('anchorScrollHandledKeyRef.current = null');
    expect(contextCatch).toContain('pendingAnchorMessageIdRef.current = null');
    expect(contextCatch).toContain('contextMessages = []');
    expect(contextCatch).toContain('setAnchorHasHistoryGap(false)');
    expect(contextCatch).toContain('setHighlightedMessageId(null)');
    expect(contextCatch).toContain('setAnchorLoadFailed(true)');
  });

  test('uses the direct newest-first data index for the inverted list', () => {
    expect(source).toContain('inverted');
    expect(source).toContain(
      'const anchorIndex = messages.findIndex(',
    );
    expect(source).toContain('index: anchorIndex');
    expect(source).toContain('viewPosition: 0.5');
    expect(source).not.toContain('messages.length - anchorIndex');
    expect(source).not.toContain('.reverse().findIndex');
  });

  test('falls back to a measured approximate offset and bounded exact retry', () => {
    expect(source).toContain(
      'onScrollToIndexFailed={handleAnchorScrollToIndexFailed}',
    );
    expect(source).toContain(
      'const currentAnchorIndex = messagesRef.current.findIndex(',
    );
    expect(source).toContain('info.averageItemLength * currentAnchorIndex');
    expect(source).toContain('scrollToOffset({');
    expect(source).toContain('anchorScrollRetryCountRef.current >= 2');
    expect(source).toContain('index: retryIndex');
  });

  test('highlights the target temporarily and keeps failure guidance non-enumerating', () => {
    expect(source).toContain('setHighlightedMessageId(routeAnchorMessageId)');
    expect(source).toContain('isHighlighted && styles.anchorMessageRow');
    expect(source).toContain('isHighlighted && styles.anchorMessageBubble');
    expect(source).toContain(
      'setTimeout(() => setHighlightedMessageId(null), 4_000)',
    );
    expect(source).toContain("logger.warn('[group-chat] anchor context unavailable', {");
    expect(source).toContain("reason: 'anchor_context_unavailable'");
    expect(source).not.toContain('anchor context unavailable\', error');
    expect(source).toContain('hasInvalidAnchorRoute || anchorLoadFailed');
    expect(source).toContain('const showAnchorReturnToLatest = Boolean(');
    expect(source).toContain('&& !hasInvalidAnchorRoute');
    expect(source).toContain('&& !anchorLoadFailed');
    expect(source).toContain('{anchorHasHistoryGap');
    expect(source).toContain('flatListRef.current?.scrollToOffset({ offset: 0, animated: true })');
  });

  test('preserves reply, reaction, delete, and keyboard contracts', () => {
    expect(source).toContain('handleReplyAction');
    expect(source).toContain('groupChatSetReaction');
    expect(source).toContain('groupChatDeleteMessage');
    expect(source).toContain('getChatComposerBottomPadding({');
    expect(source).toContain('{ paddingBottom: composerBottomPadding }');
  });
});

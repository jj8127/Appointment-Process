import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const chatPath = join(root, 'app', 'chat.tsx');

describe('mobile direct-chat anchor context source', () => {
  it('strictly parses the optional anchor and fetches context for the canonical room', () => {
    const source = readFileSync(chatPath, 'utf8');
    const loadStart = source.indexOf('const loadAnchorContext = useCallback');
    const loadEnd = source.indexOf('  useEffect(() => {', loadStart);
    const loadSource = source.slice(loadStart, loadEnd);

    expect(source).toContain('anchorMessageId?: string | string[];');
    expect(source).toContain(
      'parseExactlyOneUuidRouteParam(anchorMessageId)',
    );
    expect(source).toContain('hasInvalidAnchorRouteParam');
    expect(source).toMatch(
      /hasPresentRouteParam\(anchorMessageId\)[\s\S]{0,100}!conversationIdValue/,
    );
    expect(source).toContain('fetchGaraminDirectMessageContext');
    expect(loadSource).toContain('conversationId: resolvedConversation.id');
    expect(loadSource).toContain('messageId: anchorMessageIdValue');
    expect(loadSource).not.toContain('markGaraminDirectMessagesRead');
    expect(loadSource).not.toContain('markIncomingAsRead');
  });

  it('keeps bounded context merged without replacing full live messages', () => {
    const source = readFileSync(chatPath, 'utf8');
    const fetchStart = source.indexOf('const fetchMessages = useCallback');
    const fetchEnd = source.indexOf('  useEffect(() => {', fetchStart);
    const fetchSource = source.slice(fetchStart, fetchEnd);

    expect(source).toContain('contextMessagesRef.current = contextMessages;');
    expect(source).toContain(
      'applyMessages([...messagesRef.current, ...contextMessages]);',
    );
    expect(fetchSource).toContain(
      'applyMessages([...filtered, ...contextMessagesRef.current]);',
    );
  });

  it('uses the signed server sender side instead of comparing display labels', () => {
    const source = readFileSync(chatPath, 'utf8');
    const loadStart = source.indexOf('const loadAnchorContext = useCallback');
    const loadEnd = source.indexOf('  useEffect(() => {', loadStart);
    const loadSource = source.slice(loadStart, loadEnd);

    expect(loadSource).toContain(
      "const isIncoming = message.senderSide === 'counterparty';",
    );
    expect(loadSource).not.toContain('counterpartyLabels');
    expect(loadSource).not.toContain('normalizeLabel(message.senderLabel)');
  });

  it('centers and highlights the exact anchor with a bounded measurement fallback', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain('pendingAnchorMessageId');
    expect(source).toContain('anchorScrollTargetMessageIdRef');
    expect(source).toContain('messagesRef.current.findIndex(');
    expect(source).toContain('scrollToIndex({');
    expect(source).toContain('viewPosition: 0.5');
    expect(source).toContain('onScrollToIndexFailed={handleAnchorScrollFailure}');
    expect(source).toContain('scrollToOffset({');
    expect(source).toContain('const ANCHOR_SCROLL_RETRY_LIMIT = 3;');
    expect(source).toContain('ANCHOR_SCROLL_RETRY_DELAY_MS * retryAttempt');
    expect(source).not.toContain('info.index !== targetIndex');
    expect(source).toContain('highlightedMessageId === item.id');
    expect(source).toContain('styles.msgRowHighlighted');
  });

  it('re-centers the same message id after initial history merges and then stabilizes', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain('anchorLastScrollSignatureRef');
    expect(source).toContain('anchorHistoryStabilizedRef');
    expect(source).toContain("const historyPhase = messageLoadState === 'success' ? 'settled' : 'pending';");
    expect(source).toContain("targetMessage.is_context_preview ? 'context' : 'live'");
    expect(source).toContain(
      '(message) => message.id === pendingAnchorMessageId',
    );
    expect(source).toContain('anchorHistoryStabilizedRef.current = true;');
  });

  it('falls back to a canonical history row and offers a return-to-latest action', () => {
    const source = readFileSync(chatPath, 'utf8');
    const loadStart = source.indexOf('const loadAnchorContext = useCallback');
    const loadEnd = source.indexOf('  useEffect(() => {', loadStart);
    const loadSource = source.slice(loadStart, loadEnd);

    expect(source).toContain('const activateAnchorMessage = useCallback');
    expect(loadSource).toContain('activateAnchorMessage(anchorMessageIdValue)');
    expect(source).toContain(
      '!messages.some((message) => message.id === anchorMessageIdValue)',
    );
    expect(source).toContain('accessibilityLabel="최신 메시지로 이동"');
    expect(source).toContain('<Text style={styles.anchorLatestButtonText}>최신 메시지로</Text>');
    expect(source).toContain('flatListRef.current?.scrollToOffset({ offset: 0, animated: true });');
    expect(source).toContain('setAnchorNavigationDismissed(true);');
  });

  it('uses one identity-neutral failure message for invalid or inaccessible anchors', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain('ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE');
    expect(source).toContain(
      'setAnchorContextError(ANCHOR_CONTEXT_UNAVAILABLE_MESSAGE);',
    );
    expect(source).toContain('hasInvalidAnchorRouteParam');
    expect(source).not.toContain('setAnchorContextError(error');
  });

  it('preserves the protected keyboard layout contract', () => {
    const source = readFileSync(chatPath, 'utf8');

    expect(source).toContain('getChatComposerBottomPadding({');
    expect(source).toContain('keyboardVerticalOffset={0}');
    expect(source).toContain('paddingBottom: composerBottomPadding');
  });
});

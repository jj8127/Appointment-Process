import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Scrolled this far from the newest message (offset 0 in an inverted list) counts as reading older history.
const AWAY_FROM_LATEST_OFFSET = 320;

/**
 * Tracks whether an inverted chat list is scrolled away from the newest message and whether
 * someone else's message arrived meanwhile, so the screen can offer a jump back down.
 */
export function useLatestMessageJump<T extends { id: string }>(
  messages: readonly T[],
  isOwnMessage: (message: T) => boolean,
  listRef: RefObject<FlatList<T> | null>,
) {
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const awayRef = useRef(false);
  const newestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const newest = messages[0];
    const previousNewestId = newestIdRef.current;
    newestIdRef.current = newest?.id ?? null;
    if (!newest || !previousNewestId || newest.id === previousNewestId) return;
    if (awayRef.current && !isOwnMessage(newest)) setHasNewMessage(true);
  }, [isOwnMessage, messages]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const away = event.nativeEvent.contentOffset.y > AWAY_FROM_LATEST_OFFSET;
    if (away === awayRef.current) return;
    awayRef.current = away;
    setAwayFromLatest(away);
    if (!away) setHasNewMessage(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setHasNewMessage(false);
  }, [listRef]);

  return { awayFromLatest, hasNewMessage, onScroll, jumpToLatest };
}

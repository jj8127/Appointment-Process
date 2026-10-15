import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Skeleton } from '@/components/LoadingSkeleton';
import { QueryReadState } from '@/components/QueryReadState';
import { type BoardActor, fetchBoardCategories, fetchBoardList } from '@/lib/board-api';
import { FC_HOME_MOTION, formatHomeRelativeTime, getHomeCategoryTone, isRecentHomePost } from '@/lib/fc-home-sections';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const ALL = '';
const ALL_COLOR = '#111827';

type LatestNotice = { title: string; created_at?: string | null } | null | undefined;

type Props = {
  actor: BoardActor | null;
  sessionScope: number | string;
  latestNotice: LatestNotice;
  latestNoticeLoading: boolean;
  onOpenNotice: () => void;
  onOpenPost: (postId: string) => void;
  onOpenBoard: () => void;
};

function CategoryTag({ name }: { name: string | undefined }) {
  if (!name) return null;
  const tone = getHomeCategoryTone(name);
  return <Text style={[styles.tag, { backgroundColor: tone.background, color: tone.color }]}>{name}</Text>;
}

export function FcHomeNews({ actor, sessionScope, latestNotice, latestNoticeLoading, onOpenNotice, onOpenPost, onOpenBoard }: Props) {
  const reduceMotion = useReducedMotion();
  const [categoryId, setCategoryId] = useState(ALL);
  const categoriesQuery = useQuery({
    queryKey: ['board-categories'],
    queryFn: () => (actor ? fetchBoardCategories(actor) : Promise.resolve([])),
    enabled: !!actor,
  });
  // Shares the board's ['board-posts'] prefix so reactions/comments made on the board refresh this list.
  const postsQuery = useQuery({
    queryKey: ['board-posts', actor?.role, actor?.residentId, 'home', categoryId, sessionScope],
    queryFn: () => (actor ? fetchBoardList(actor, { categoryId: categoryId || undefined, limit: 6 }) : Promise.resolve({ items: [] })),
    enabled: !!actor,
  });
  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((category) => category.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [categoriesQuery.data],
  );
  const categoryName = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const chips = useMemo(() => [{ id: ALL, name: '전체' }, ...categories.map(({ id, name }) => ({ id, name }))], [categories]);
  const posts = postsQuery.data?.items ?? [];
  // The prototype leads with one large post: a pinned one when present, otherwise the newest.
  const featured = posts.find((post) => post.isPinned) ?? posts[0] ?? null;
  const rows = posts.filter((post) => post !== featured).slice(0, 2);
  const recentCount = categoryId === ALL ? posts.filter((post) => isRecentHomePost(post.createdAt)).length : 0;
  const [allRecentCount, setAllRecentCount] = useState(0);
  useEffect(() => {
    if (categoryId === ALL && postsQuery.data) setAllRecentCount(recentCount);
  }, [categoryId, postsQuery.data, recentCount]);

  // The selection pill slides to the tapped chip.
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillColor = useSharedValue(ALL_COLOR);
  const selectedColor = (id: string) => (id === ALL ? ALL_COLOR : getHomeCategoryTone(categoryName.get(id)).color);
  const movePill = (id: string, animate: boolean) => {
    const layout = layouts.current[id];
    if (!layout) return;
    const duration = animate && !reduceMotion ? FC_HOME_MOTION.chipIndicator : 0;
    pillX.value = withTiming(layout.x, { duration, easing: EASE });
    pillWidth.value = withTiming(layout.width, { duration, easing: EASE });
    pillColor.value = withTiming(selectedColor(id), { duration, easing: EASE });
  };
  const pillStyle = useAnimatedStyle(() => ({
    width: pillWidth.value,
    backgroundColor: pillColor.value,
    transform: [{ translateX: pillX.value }],
  }));
  const onChipLayout = (id: string) => (event: LayoutChangeEvent) => {
    layouts.current[id] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width };
    if (id === categoryId) movePill(id, false);
  };

  // The list rises in when the category changes.
  const listIn = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    listIn.value = 0;
    listIn.value = withTiming(1, { duration: FC_HOME_MOTION.contentSwap, easing: EASE });
  }, [categoryId, listIn, reduceMotion]);
  const listStyle = useAnimatedStyle(() => ({ opacity: listIn.value, transform: [{ translateY: (1 - listIn.value) * 6 }] }));

  const selectCategory = (id: string) => {
    if (id === categoryId) return;
    setCategoryId(id);
    movePill(id, true);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.sectionTitle}>
          <Image source={require('@/assets/images/fc-home/section-notice.png')} style={styles.sectionIcon} accessibilityIgnoresInvertColors />
          <Text style={styles.title}>
            새 소식{allRecentCount > 0 ? <Text style={styles.titleCount}> {allRecentCount}</Text> : null}
          </Text>
        </View>
        <Pressable onPress={onOpenBoard} hitSlop={8} accessibilityRole="button" accessibilityLabel="게시판 열기">
          <Text style={styles.link}>게시판</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        <Animated.View style={[styles.pill, pillStyle]} />
        {chips.map((chip) => {
          const selected = chip.id === categoryId;
          // Idle chips wear their category tint; the sliding pill takes the category's strong color.
          const tone = chip.id === ALL ? null : getHomeCategoryTone(chip.name);
          return (
            <Pressable
              key={chip.id || 'all'}
              onLayout={onChipLayout(chip.id)}
              onPress={() => selectCategory(chip.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.chip, !selected && (tone ? { backgroundColor: tone.background } : styles.chipIdle)]}
            >
              <Text style={[styles.chipText, !selected && tone && { color: tone.color, fontWeight: '600' }, selected && styles.chipTextSelected]}>
                {chip.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {postsQuery.isError ? (
        <QueryReadState error={postsQuery.error} message="게시글을 불러오지 못했습니다." onRetry={() => void postsQuery.refetch()} retrying={postsQuery.isFetching} />
      ) : postsQuery.isLoading ? (
        <View style={styles.loading}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={20} />
        </View>
      ) : (
        <Animated.View style={listStyle}>
          {featured ? (
            <Pressable
              onPress={() => onOpenPost(featured.id)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.featured, pressed && styles.featuredPressed]}
            >
              <View style={styles.metaRow}>
                {featured.isPinned ? <Text style={[styles.tag, styles.tagPinned]}>필독</Text> : null}
                <CategoryTag name={categoryName.get(featured.categoryId)} />
                <View style={styles.flex} />
                <Text style={styles.time}>{formatHomeRelativeTime(featured.createdAt)}</Text>
              </View>
              <Text style={styles.featuredTitle} numberOfLines={2}>{featured.title}</Text>
              {featured.contentPreview ? <Text style={styles.featuredPreview} numberOfLines={2}>{featured.contentPreview}</Text> : null}
              <View style={styles.metaRow}>
                <Text style={styles.author} numberOfLines={1}>{featured.authorName}</Text>
                <View style={styles.flex} />
                <View style={styles.stat}>
                  <Feather name="heart" size={14} color="#4b5563" />
                  <Text style={styles.author}>{featured.stats.reactionCount}</Text>
                </View>
                <View style={styles.stat}>
                  <Feather name="message-circle" size={14} color="#4b5563" />
                  <Text style={styles.author}>{featured.stats.commentCount}</Text>
                </View>
              </View>
            </Pressable>
          ) : null}
          {rows.map((post, rowIndex) => {
            const recent = isRecentHomePost(post.createdAt);
            return (
              <Pressable
                key={post.id}
                onPress={() => onOpenPost(post.id)}
                accessibilityRole="button"
                accessibilityLabel={recent ? `새 글, ${post.title}` : post.title}
                style={({ pressed }) => [styles.row, rowIndex < rows.length - 1 && styles.rowDivider, pressed && styles.rowPressed]}
              >
                <CategoryTag name={categoryName.get(post.categoryId)} />
                <Text style={[styles.rowTitle, !recent && styles.rowTitleOld]} numberOfLines={1}>{post.title}</Text>
                {recent ? <View style={styles.newDot} /> : null}
                <Text style={styles.time}>{formatHomeRelativeTime(post.createdAt)}</Text>
              </Pressable>
            );
          })}
          {!featured ? <Text style={styles.empty}>게시글이 없습니다</Text> : null}
        </Animated.View>
      )}

      <Pressable
        onPress={onOpenNotice}
        accessibilityRole="button"
        accessibilityLabel="최신 공지사항 열기"
        style={({ pressed }) => [styles.noticeRow, pressed && styles.rowPressed]}
      >
        <Feather name="volume-2" size={16} color="#a8460f" />
        <Text style={styles.noticeTitle} numberOfLines={1}>
          {latestNoticeLoading ? '공지사항을 불러오는 중' : latestNotice?.title ?? '등록된 공지사항이 없습니다'}
        </Text>
        <Feather name="chevron-right" size={16} color="#9ca3af" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 8, backgroundColor: '#ffffff', borderRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionIcon: { width: 28, height: 28 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  titleCount: { fontSize: 15, color: '#c65312' },
  link: { fontSize: 14, fontWeight: '500', color: '#4b5563' },
  flex: { flex: 1 },
  chips: { gap: 6, paddingBottom: 14 },
  pill: { position: 'absolute', left: 0, top: 0, height: 34, borderRadius: 17 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center' },
  chipIdle: { backgroundColor: '#f3f4f6' },
  chipText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  chipTextSelected: { color: '#ffffff', fontWeight: '700' },
  loading: { gap: 10, paddingBottom: 10 },
  featured: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: '#f7f8fa' },
  featuredPressed: { backgroundColor: '#eef0f3' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featuredTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: '#111827' },
  featuredPreview: { fontSize: 14, lineHeight: 20, color: '#4b5563' },
  author: { fontSize: 13, color: '#4b5563', flexShrink: 1 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6 },
  tag: { fontSize: 12, fontWeight: '700', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  tagPinned: { color: '#ffffff', backgroundColor: '#c65312' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#f1f2f4' },
  rowPressed: { opacity: 0.7 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: '#111827' },
  rowTitleOld: { fontWeight: '500', color: '#374151' },
  newDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f36f21' },
  time: { fontSize: 12, color: '#6b7280' },
  empty: { paddingVertical: 16, fontSize: 14, color: '#6b7280', textAlign: 'center' },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f1f2f4' },
  noticeTitle: { flex: 1, minWidth: 0, fontSize: 14, color: '#374151' },
});

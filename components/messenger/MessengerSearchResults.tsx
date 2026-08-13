import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  MessengerSearchResult,
  MessengerSearchSourceResult,
  MessengerSearchTab,
} from '@/lib/messenger-search-model';
import { groupMessengerSearchResultsByKind } from '@/lib/messenger-search-model';

const SOURCE_LABELS = {
  internal: '가람in 1:1',
  group: '단체 채팅',
  garamlink: '가람Link',
} as const;

const KIND_LABELS = {
  person: '친구',
  room: '채팅방',
  message: '메시지',
} as const;

function HighlightedText({ text, query, style }: { text: string; query: string; style: object }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return <Text style={style}>{text}</Text>;
  const index = text.toLocaleLowerCase('ko-KR').indexOf(normalizedQuery.toLocaleLowerCase('ko-KR'));
  if (index < 0) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, index)}
      <Text style={styles.highlight}>{text.slice(index, index + normalizedQuery.length)}</Text>
      {text.slice(index + normalizedQuery.length)}
    </Text>
  );
}

function ResultIcon({ item }: { item: MessengerSearchResult }) {
  const icon = item.kind === 'person' ? 'user' : item.kind === 'room' ? 'message-circle' : 'align-left';
  return (
    <View style={styles.iconCircle}>
      <Feather name={icon} size={19} color="#F36F21" />
    </View>
  );
}

function ResultRow({
  item,
  query,
  onOpen,
}: {
  item: MessengerSearchResult;
  query: string;
  onOpen: (item: MessengerSearchResult) => void;
}) {
  const title = item.kind === 'person' ? item.name : item.kind === 'room' ? item.title : item.senderName;
  const detail = item.kind === 'message' ? item.text : item.detail;
  const disabled = item.kind === 'person' && item.route === null;
  return (
    <Pressable
      accessibilityRole={disabled ? undefined : 'button'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
    >
      <ResultIcon item={item} />
      <View style={styles.resultCopy}>
        <HighlightedText query={query} style={styles.resultTitle} text={title} />
        <HighlightedText query={query} style={styles.resultDetail} text={detail} />
        <Text style={styles.sourceLabel}>{SOURCE_LABELS[item.source]}</Text>
        {item.kind === 'message' && item.coverage === 'partial' ? (
          <Text style={styles.partialLabel}>일부 결과만 표시될 수 있습니다.</Text>
        ) : null}
        {disabled ? <Text style={styles.disabledLabel}>기존 채팅방에서만 열 수 있습니다.</Text> : null}
      </View>
      {!disabled ? <Feather name="chevron-right" size={20} color="#BBBBBB" /> : null}
    </Pressable>
  );
}

export default function MessengerSearchResults({
  sources,
  activeTab,
  query,
  onOpen,
  onRetry,
}: {
  sources: MessengerSearchSourceResult[];
  activeTab: MessengerSearchTab;
  query: string;
  onOpen: (item: MessengerSearchResult) => void;
  onRetry: (source: MessengerSearchSourceResult['source']) => void;
}) {
  const hasAnyItems = sources.some((source) => source.items.length > 0);
  const sections = groupMessengerSearchResultsByKind(sources, activeTab);
  const allSettled = sources.every((source) =>
    source.status === 'ready' || source.status === 'empty' || source.status === 'hint'
  );

  return (
    <View style={styles.container}>
      {sources.some((source) => source.status === 'loading' || source.status === 'retrying') ? (
        <View style={styles.stateRow}>
          <ActivityIndicator color="#F36F21" size="small" />
          <Text style={styles.stateText}>검색 결과를 모으고 있습니다.</Text>
        </View>
      ) : null}

      {sources.filter((source) => source.status === 'error').map((source) => (
        <View key={`error:${source.source}`} style={styles.errorRow}>
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>
              {SOURCE_LABELS[source.source]} · {source.error ?? '결과를 불러오지 못했습니다.'}
            </Text>
            {source.items.length > 0 ? <Text style={styles.stateText}>불러온 결과는 그대로 표시합니다.</Text> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={() => onRetry(source.source)} style={styles.retryButton}>
            <Text style={styles.retryLabel}>다시 시도</Text>
          </Pressable>
        </View>
      ))}

      {sections.filter((section) =>
        section.items.length > 0
        || (activeTab !== 'all' && hasAnyItems)
        || sources.some((source) => source.status === 'hint' && section.kind === 'message')
      ).map((section) => (
        <View key={section.kind} style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{KIND_LABELS[section.kind]}</Text>
            <Text style={styles.sectionCount}>{section.items.length}</Text>
          </View>
          {section.kind === 'message' && sources.some((source) => source.status === 'hint') ? (
            <View style={styles.stateRow}>
              <Feather name="info" size={17} color="#F36F21" />
              <Text style={styles.stateText}>메시지는 두 글자부터 검색할 수 있습니다.</Text>
            </View>
          ) : null}
          {section.items.map((item) => (
            <ResultRow item={item} key={item.key} onOpen={onOpen} query={query} />
          ))}
          {section.items.length === 0 && !sources.some((source) =>
            source.status === 'loading' || source.status === 'retrying' || source.status === 'hint') ? (
              <Text style={styles.emptySource}>일치하는 결과가 없습니다.</Text>
            ) : null}
        </View>
      ))}
      {allSettled && !hasAnyItems && !sources.some((source) => source.status === 'hint') ? (
        <View style={styles.globalEmpty}>
          <Feather name="search" size={30} color="#C4C4C4" />
          <Text style={styles.globalEmptyTitle}>검색 결과가 없습니다.</Text>
          <Text style={styles.globalEmptyBody}>이름이나 메시지의 일부를 다시 입력해 보세요.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 36 },
  section: { borderBottomColor: '#ECECEC', borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 48, paddingHorizontal: 20 },
  sectionTitle: { color: '#333333', fontSize: 14, fontWeight: '700' },
  sectionCount: { color: '#F36F21', fontSize: 13, fontWeight: '700' },
  resultRow: { alignItems: 'center', flexDirection: 'row', minHeight: 68, paddingHorizontal: 20, paddingVertical: 9 },
  pressed: { backgroundColor: '#F7F7F7' },
  iconCircle: { alignItems: 'center', backgroundColor: '#FFF2E9', borderRadius: 21, height: 42, justifyContent: 'center', width: 42 },
  resultCopy: { flex: 1, gap: 3, paddingHorizontal: 13 },
  resultTitle: { color: '#242424', fontSize: 15, fontWeight: '700' },
  resultDetail: { color: '#696969', fontSize: 13, lineHeight: 18 },
  sourceLabel: { color: '#999999', fontSize: 11 },
  highlight: { color: '#F36F21', fontWeight: '800' },
  partialLabel: { color: '#9A6A4A', fontSize: 11 },
  disabledLabel: { color: '#999999', fontSize: 11 },
  stateRow: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 52, paddingHorizontal: 20 },
  stateText: { color: '#7A7A7A', fontSize: 13 },
  errorRow: { alignItems: 'center', flexDirection: 'row', minHeight: 62, paddingHorizontal: 20, paddingVertical: 8 },
  errorCopy: { flex: 1, gap: 3, paddingRight: 12 },
  errorTitle: { color: '#A14C1C', fontSize: 13, fontWeight: '600' },
  retryButton: { alignItems: 'center', borderColor: '#F36F21', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
  retryLabel: { color: '#F36F21', fontSize: 13, fontWeight: '700' },
  emptySource: { color: '#999999', fontSize: 13, paddingBottom: 14, paddingHorizontal: 20 },
  globalEmpty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48 },
  globalEmptyTitle: { color: '#444444', fontSize: 16, fontWeight: '700', marginTop: 13 },
  globalEmptyBody: { color: '#898989', fontSize: 13, marginTop: 6 },
});

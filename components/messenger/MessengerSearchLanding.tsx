import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

type Props = {
  recentQueries: string[];
  saveEnabled: boolean;
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClearAll: () => void;
  onToggleSave: (enabled: boolean) => void;
};

export default function MessengerSearchLanding(props: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.helper}>
        <Feather name="search" size={22} color="#F36F21" />
        <View style={styles.helperCopy}>
          <Text style={styles.helperTitle}>메신저 전체에서 찾아보세요</Text>
          <Text style={styles.helperBody}>사람과 채팅방은 현재 목록에서, 메시지는 열람 가능한 범위에서 검색합니다.</Text>
        </View>
      </View>

      <View style={styles.headingRow}>
        <Text style={styles.heading}>최근 검색</Text>
        {props.recentQueries.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={props.onClearAll} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>전체 삭제</Text>
          </Pressable>
        ) : null}
      </View>

      {props.recentQueries.length === 0 ? (
        <Text style={styles.empty}>최근 검색어가 없습니다.</Text>
      ) : props.recentQueries.map((query) => (
        <View key={query} style={styles.recentRow}>
          <Pressable onPress={() => props.onSelect(query)} style={styles.recentQuery}>
            <Feather name="clock" size={18} color="#8A8A8A" />
            <Text numberOfLines={1} style={styles.recentText}>{query}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${query} 삭제`}
            hitSlop={8}
            onPress={() => props.onRemove(query)}
            style={styles.removeButton}
          >
            <Feather name="x" size={19} color="#909090" />
          </Pressable>
        </View>
      ))}

      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={styles.toggleTitle}>최근 검색어 저장</Text>
          <Text style={styles.toggleBody}>앱을 종료하면 검색 기록은 사라집니다.</Text>
        </View>
        <Switch
          accessibilityLabel="최근 검색어 저장"
          onValueChange={props.onToggleSave}
          thumbColor="#FFFFFF"
          trackColor={{ false: '#D5D5D5', true: '#F36F21' }}
          value={props.saveEnabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 24 },
  helper: {
    alignItems: 'flex-start',
    backgroundColor: '#FFF7F2',
    flexDirection: 'row',
    gap: 13,
    marginBottom: 28,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  helperCopy: { flex: 1, gap: 5 },
  helperTitle: { color: '#242424', fontSize: 16, fontWeight: '700' },
  helperBody: { color: '#686868', fontSize: 13, lineHeight: 19 },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  heading: { color: '#202020', fontSize: 17, fontWeight: '700' },
  textButton: { justifyContent: 'center', minHeight: 44, paddingLeft: 16 },
  textButtonLabel: { color: '#777777', fontSize: 13 },
  empty: { color: '#929292', fontSize: 14, paddingHorizontal: 20, paddingVertical: 25 },
  recentRow: { alignItems: 'center', flexDirection: 'row', minHeight: 48, paddingLeft: 20, paddingRight: 8 },
  recentQuery: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, minHeight: 48 },
  recentText: { color: '#303030', flex: 1, fontSize: 15 },
  removeButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  toggleRow: {
    alignItems: 'center',
    borderTopColor: '#EEEEEE',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 16,
    minHeight: 68,
  },
  toggleCopy: { flex: 1, gap: 3, paddingRight: 16 },
  toggleTitle: { color: '#333333', fontSize: 14, fontWeight: '600' },
  toggleBody: { color: '#8A8A8A', fontSize: 12 },
});

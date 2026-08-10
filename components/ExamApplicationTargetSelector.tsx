import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ExamApplicationTarget } from '@/lib/exam-payment-proof-api';

type Props = {
  targets: ExamApplicationTarget[];
  value: ExamApplicationTarget | null;
  onChange: (target: ExamApplicationTarget) => void;
  isLoading?: boolean;
  disabled?: boolean;
};

const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase('ko-KR');

export function ExamApplicationTargetSelector({
  targets,
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const normalizedSearch = normalizeSearch(search);
  const filteredTargets = useMemo(
    () => targets.filter((target) => {
      if (!normalizedSearch) return true;
      return [
        target.name,
        target.affiliation,
        target.phoneLast4,
      ].some((field) => normalizeSearch(field).includes(normalizedSearch));
    }),
    [normalizedSearch, targets],
  );

  const selectTarget = (target: ExamApplicationTarget) => {
    onChange(target);
    setSearch('');
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>시험 신청 대상 FC</Text>
      <Text style={styles.hint}>대리 신청할 FC를 먼저 선택해주세요.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="시험 신청 대상 FC 선택"
        disabled={disabled || isLoading}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.selector,
          (disabled || isLoading) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.selectorText}>
          <Text style={[styles.name, !value && styles.placeholder]}>
            {isLoading ? 'FC 목록을 불러오는 중...' : value?.name ?? 'FC를 선택해주세요'}
          </Text>
          {value ? (
            <Text style={styles.meta}>
              {value.affiliation || '소속 미입력'} · 연락처 끝 {value.phoneLast4}
            </Text>
          ) : null}
        </View>
        <Feather name="chevron-down" size={20} color="#6B7280" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>시험 신청 대상 선택</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="대상 선택 닫기"
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <Feather name="x" size={22} color="#111827" />
              </Pressable>
            </View>
            <View style={styles.searchBox}>
              <Feather name="search" size={18} color="#6B7280" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="이름, 소속, 전화번호 끝 4자리 검색"
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
                style={styles.searchInput}
              />
            </View>
            <FlatList
              data={filteredTargets}
              keyExtractor={(item) => item.fcId}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={filteredTargets.length === 0 ? styles.emptyList : undefined}
              ListEmptyComponent={<Text style={styles.empty}>검색 결과가 없습니다.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => selectTarget(item)}
                  style={({ pressed }) => [
                    styles.row,
                    item.fcId === value?.fcId && styles.rowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowMeta}>
                      {item.affiliation || '소속 미입력'} · 연락처 끝 {item.phoneLast4}
                    </Text>
                  </View>
                  {item.fcId === value?.fcId ? (
                    <Feather name="check-circle" size={20} color="#F36F21" />
                  ) : null}
                </Pressable>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: '#111827', fontSize: 15, fontWeight: '800' },
  hint: { color: '#6B7280', fontSize: 12 },
  selector: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: { flex: 1, gap: 3 },
  name: { color: '#111827', fontSize: 15, fontWeight: '700' },
  placeholder: { color: '#9CA3AF', fontWeight: '500' },
  meta: { color: '#6B7280', fontSize: 12 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
  overlay: { flex: 1, backgroundColor: 'rgba(17,24,39,0.4)', justifyContent: 'flex-end' },
  sheet: {
    height: '78%',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#111827', fontSize: 19, fontWeight: '800' },
  close: { padding: 6 },
  searchBox: {
    marginTop: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  searchInput: { flex: 1, minHeight: 46, marginLeft: 8, color: '#111827' },
  row: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSelected: { backgroundColor: '#FFF7ED' },
  rowText: { flex: 1, gap: 3 },
  rowName: { color: '#111827', fontSize: 15, fontWeight: '700' },
  rowMeta: { color: '#6B7280', fontSize: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { color: '#6B7280', textAlign: 'center' },
});

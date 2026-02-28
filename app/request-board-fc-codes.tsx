import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigation } from '@/components/BottomNavigation';
import { useSession } from '@/hooks/use-session';
import { resolveBottomNavActiveKey, resolveBottomNavPreset } from '@/lib/bottom-navigation';
import { logger } from '@/lib/logger';
import {
  rbCreateFcCode,
  rbDeleteFcCode,
  rbGetCompanyNames,
  rbGetFcCodes,
  rbUpdateFcCode,
  type RbFcCode,
} from '@/lib/request-board-api';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/* ─── Helpers ─── */

const normalizeKey = (v: string) => v.replace(/\s+/g, '').trim().toLowerCase();

const formatDate = (value: string) => {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

/* ─── Component ─── */

export default function RequestBoardFcCodesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { role, readOnly, hydrated, isRequestBoardDesigner } = useSession();

  const [codes, setCodes] = useState<RbFcCode[]>([]);
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Add/Edit modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCode, setEditingCode] = useState<RbFcCode | null>(null);
  const [formInsurerName, setFormInsurerName] = useState('');
  const [formCodeValue, setFormCodeValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Inline autocomplete suggestions
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<RbFcCode | null>(null);

  // Missing companies panel
  const [missingPanelVisible, setMissingPanelVisible] = useState(false);

  /* ─── Fetch ─── */
  const fetchData = useCallback(async () => {
    setFetchError(null);
    try {
      const [codesData, namesData] = await Promise.all([
        rbGetFcCodes(),
        rbGetCompanyNames(),
      ]);
      setCodes(codesData);
      setCompanyNames(namesData);
    } catch (err) {
      logger.warn('[fc-codes] fetch failed', err);
      setFetchError('데이터를 불러오는데 실패했습니다. 가람Link에 로그인 상태를 확인해주세요.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  /* ─── Derived data ─── */
  const activeCodes = useMemo(
    () => codes.filter((c) => c.is_active !== false),
    [codes],
  );

  const filteredCodes = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    return activeCodes
      .filter((c) => {
        if (!kw) return true;
        return (
          c.insurer_name.toLowerCase().includes(kw) ||
          c.code_value.toLowerCase().includes(kw)
        );
      })
      .sort((a, b) => a.insurer_name.localeCompare(b.insurer_name));
  }, [activeCodes, searchQuery]);

  const missingCompanies = useMemo(() => {
    const existing = new Set(activeCodes.map((c) => normalizeKey(c.insurer_name)));
    return companyNames
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !existing.has(normalizeKey(n)))
      .sort((a, b) => a.localeCompare(b));
  }, [activeCodes, companyNames]);

  const filteredCompanyNames = useMemo(() => {
    const kw = formInsurerName.trim().toLowerCase();
    const src = companyNames.filter((n) => n.trim().length > 0);
    if (!kw) return src.slice(0, 6);
    return src.filter((n) => n.toLowerCase().includes(kw)).slice(0, 6);
  }, [companyNames, formInsurerName]);

  const existingForInsurer = useMemo(() => {
    const key = normalizeKey(formInsurerName);
    if (!key) return null;
    return activeCodes.find((c) => normalizeKey(c.insurer_name) === key) ?? null;
  }, [activeCodes, formInsurerName]);

  /* ─── Modal actions ─── */
  const openAdd = () => {
    setEditingCode(null);
    setFormInsurerName('');
    setFormCodeValue('');
    setFormError(null);
    setShowSuggestions(false);
    setEditModalVisible(true);
  };

  const openEdit = (code: RbFcCode) => {
    setEditingCode(code);
    setFormInsurerName(code.insurer_name);
    setFormCodeValue(code.code_value);
    setFormError(null);
    setShowSuggestions(false);
    setEditModalVisible(true);
  };

  const closeEditModal = () => {
    setEditModalVisible(false);
    setShowSuggestions(false);
  };

  const handleSave = async () => {
    if (!formInsurerName.trim()) {
      setFormError('회사명을 입력해주세요.');
      return;
    }
    if (!formCodeValue.trim()) {
      setFormError('코드값을 입력해주세요.');
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (editingCode) {
        const res = await rbUpdateFcCode(editingCode.id, {
          insurerName: formInsurerName.trim(),
          codeValue: formCodeValue.trim(),
        });
        if (!res.success) throw new Error(res.error ?? '수정에 실패했습니다.');
      } else {
        const res = await rbCreateFcCode(formInsurerName.trim(), formCodeValue.trim());
        if (!res.success) throw new Error(res.error ?? '등록에 실패했습니다.');
      }
      closeEditModal();
      await fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (code: RbFcCode) => {
    setDeleteTarget(code);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await rbDeleteFcCode(deleteTarget.id);
      if (!res.success) throw new Error(res.error ?? '삭제에 실패했습니다.');
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '삭제에 실패했습니다.';
      Alert.alert('오류', msg);
    }
  };

  /* ─── Render ─── */

  const renderItem = ({ item }: { item: RbFcCode }) => (
    <View style={styles.codeRow}>
      <View style={styles.codeRowMain}>
        <Text style={styles.codeInsurer} numberOfLines={1}>{item.insurer_name}</Text>
        <Text style={styles.codeValue}>{item.code_value}</Text>
        <Text style={styles.codeDate}>{formatDate(item.updated_at)}</Text>
      </View>
      <View style={styles.codeRowActions}>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
          onPress={() => openEdit(item)}
        >
          <Feather name="edit-2" size={14} color={COLORS.primary} />
          <Text style={[styles.actionBtnText, { color: COLORS.primary }]}>수정</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
          onPress={() => confirmDelete(item)}
        >
          <Feather name="trash-2" size={14} color={COLORS.error} />
          <Text style={[styles.actionBtnText, { color: COLORS.error }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );

  const navPreset = resolveBottomNavPreset({
    role,
    readOnly,
    hydrated,
    isRequestBoardDesigner,
  });
  const navActiveKey = resolveBottomNavActiveKey(navPreset, 'request-board');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 4 }]}>
        <View style={styles.headerInner}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={COLORS.gray[700]} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle}>설계코드 관리</Text>
            <Text style={styles.headerSub}>회사별 설계코드를 등록하고 관리합니다</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            onPress={openAdd}
          >
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.addBtnText}>추가</Text>
          </Pressable>
        </View>
      </View>

      {/* Error */}
      {fetchError && (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={14} color={COLORS.error} />
          <Text style={styles.errorBannerText}>{fetchError}</Text>
        </View>
      )}

      {/* Search + Meta bar */}
      <View style={styles.searchBar}>
        <View style={styles.searchInputWrap}>
          <Feather name="search" size={15} color={COLORS.gray[400]} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="회사명 또는 코드값 검색"
            placeholderTextColor={COLORS.gray[400]}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Feather name="x" size={15} color={COLORS.gray[400]} />
            </Pressable>
          )}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaCount}>
            총 <Text style={styles.metaCountBold}>{filteredCodes.length}</Text>개
          </Text>
          {missingCompanies.length > 0 && (
            <Pressable
              style={[
                styles.missingChip,
                missingPanelVisible && styles.missingChipActive,
              ]}
              onPress={() => setMissingPanelVisible((v) => !v)}
            >
              <Feather name="alert-triangle" size={12} color="#B45309" />
              <Text style={styles.missingChipText}>
                미등록 {missingCompanies.length}개
              </Text>
              <Feather
                name={missingPanelVisible ? 'chevron-up' : 'chevron-down'}
                size={12}
                color="#B45309"
              />
            </Pressable>
          )}
        </View>

        {/* Missing companies expanded */}
        {missingPanelVisible && missingCompanies.length > 0 && (
          <View style={styles.missingPanel}>
            <Text style={styles.missingPanelTitle}>
              코드 미등록 회사 {missingCompanies.length}개
            </Text>
            <Text style={styles.missingPanelSub}>
              아래 회사는 FC 코드가 아직 등록되지 않았습니다
            </Text>
            <View style={styles.missingChips}>
              {missingCompanies.map((name) => (
                <Pressable
                  key={name}
                  style={styles.missingCompanyChip}
                  onPress={() => {
                    setFormInsurerName(name);
                    setFormCodeValue('');
                    setFormError(null);
                    setShowSuggestions(false);
                    setEditingCode(null);
                    setMissingPanelVisible(false);
                    setEditModalVisible(true);
                  }}
                >
                  <Text style={styles.missingCompanyText}>{name}</Text>
                  <Feather name="plus" size={11} color="#B45309" />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      ) : filteredCodes.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Feather name="tag" size={40} color={COLORS.gray[200]} />
          <Text style={styles.emptyText}>
            {searchQuery.trim() ? '검색 결과가 없습니다' : '등록된 설계코드가 없습니다'}
          </Text>
          <Text style={styles.emptySubText}>
            {searchQuery.trim()
              ? '검색어를 변경해보세요'
              : '"추가" 버튼을 눌러 코드를 등록해보세요'}
          </Text>
        </View>
      ) : (
        <>
          {/* Table header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>회사명</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.4 }]}>코드값</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>수정일</Text>
            <Text style={[styles.tableHeaderCell, { width: 80, textAlign: 'right' }]}>액션</Text>
          </View>
          <FlatList
            data={filteredCodes}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={COLORS.primary}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeEditModal} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingCode ? '설계코드 수정' : '설계코드 등록'}
              </Text>
              <Pressable onPress={closeEditModal} style={styles.modalCloseBtn}>
                <Feather name="x" size={20} color={COLORS.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {formError && (
                <View style={styles.formErrorBox}>
                  <Feather name="alert-circle" size={14} color={COLORS.error} />
                  <Text style={styles.formErrorText}>{formError}</Text>
                </View>
              )}

              {/* Company name field */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  회사명 <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={formInsurerName}
                  onChangeText={(v) => {
                    setFormInsurerName(v);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="회사명 검색 또는 직접 입력"
                  placeholderTextColor={COLORS.gray[400]}
                  returnKeyType="next"
                  autoCorrect={false}
                />
                {showSuggestions && filteredCompanyNames.length > 0 && (
                  <View style={styles.suggestionsList}>
                    {filteredCompanyNames.map((name) => (
                      <TouchableOpacity
                        key={name}
                        style={[
                          styles.suggestionItem,
                          normalizeKey(formInsurerName) === normalizeKey(name) &&
                            styles.suggestionItemSelected,
                        ]}
                        onPress={() => {
                          setFormInsurerName(name);
                          setShowSuggestions(false);
                          Keyboard.dismiss();
                        }}
                      >
                        <Text
                          style={[
                            styles.suggestionItemText,
                            normalizeKey(formInsurerName) === normalizeKey(name) &&
                              styles.suggestionItemTextSelected,
                          ]}
                        >
                          {name}
                        </Text>
                        {normalizeKey(formInsurerName) === normalizeKey(name) && (
                          <Feather name="check" size={14} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {!editingCode && existingForInsurer && (
                  <Text style={styles.fieldHint}>
                    이미 등록된 회사입니다. 등록하면 기존 코드가 갱신됩니다.
                  </Text>
                )}
              </View>

              {/* Code value field */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>
                  코드값 <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={formCodeValue}
                  onChangeText={setFormCodeValue}
                  placeholder="예: FC-001 또는 r4543446"
                  placeholderTextColor={COLORS.gray[400]}
                  autoCapitalize="none"
                  returnKeyType="done"
                />
              </View>
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <Pressable
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={closeEditModal}
              >
                <Text style={styles.cancelBtnText}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>{editingCode ? '수정' : '등록'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={!!deleteTarget}
        animationType="fade"
        transparent
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIcon}>
              <Feather name="trash-2" size={24} color={COLORS.error} />
            </View>
            <Text style={styles.confirmTitle}>설계코드 삭제</Text>
            <Text style={styles.confirmMsg}>
              <Text style={styles.confirmBold}>{deleteTarget?.insurer_name}</Text>의{' '}
              <Text style={styles.confirmBold}>{deleteTarget?.code_value}</Text> 코드를
              삭제하시겠습니까?
            </Text>
            <Text style={styles.confirmSub}>삭제된 코드는 복구할 수 없습니다.</Text>
            <View style={styles.confirmBtns}>
              <Pressable
                style={[styles.modalBtn, styles.cancelBtn, { flex: 1 }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={styles.cancelBtnText}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.deleteBtn, { flex: 1 }]}
                onPress={handleDelete}
              >
                <Text style={styles.deleteBtnText}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNavigation
        preset={navPreset ?? undefined}
        activeKey={navActiveKey}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
  },

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    ...SHADOWS.sm,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800' as const,
    color: COLORS.gray[900],
  },
  headerSub: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  addBtnText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700' as const,
    color: '#fff',
  },

  /* Error banner */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
  },
  errorBannerText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.error,
  },

  /* Search bar */
  searchBar: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.gray[50],
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    marginBottom: SPACING.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[900],
    padding: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metaCount: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  metaCountBold: {
    fontWeight: '700' as const,
    color: COLORS.gray[700],
  },
  missingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  missingChipActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  missingChipText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: '#B45309',
  },
  missingPanel: {
    backgroundColor: '#FFFBEB',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#FCD34D',
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  missingPanelTitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700' as const,
    color: '#92400E',
    marginBottom: 2,
  },
  missingPanelSub: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: '#B45309',
    marginBottom: SPACING.sm,
  },
  missingChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  missingCompanyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  missingCompanyText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: '#92400E',
    fontWeight: '600' as const,
  },

  /* Loading / Empty */
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  loadingText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '600' as const,
    color: COLORS.gray[600],
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    textAlign: 'center',
  },

  /* Table */
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  tableHeaderCell: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
    color: COLORS.gray[500],
  },

  /* Code row */
  codeRow: {
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
  },
  codeRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  codeInsurer: {
    flex: 2,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: COLORS.gray[800],
    paddingRight: 4,
  },
  codeValue: {
    flex: 1.4,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: COLORS.gray[700],
    paddingRight: 4,
  },
  codeDate: {
    flex: 1.2,
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
  },
  codeRowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
  },
  actionBtnText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '600' as const,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border.light,
    marginHorizontal: SPACING.base,
  },

  /* Modal overlay */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  /* Modal sheet */
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
  },

  /* Form */
  formErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: '#FEE2E2',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  formErrorText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.error,
  },
  fieldWrap: {
    marginBottom: SPACING.base,
  },
  fieldLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
    marginBottom: 6,
  },
  required: {
    color: COLORS.error,
  },
  fieldHint: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.primary,
    marginTop: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 12,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[800],
    backgroundColor: '#fff',
  },

  /* Modal footer */
  modalFooter: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: COLORS.gray[100],
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  cancelBtnText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '600' as const,
    color: COLORS.gray[700],
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
  },
  saveBtnText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: '#fff',
  },
  deleteBtn: {
    backgroundColor: COLORS.error,
  },
  deleteBtnText: {
    fontSize: TYPOGRAPHY.fontSize.base,
    fontWeight: '700' as const,
    color: '#fff',
  },

  /* Inline suggestions */
  suggestionsList: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  suggestionItemSelected: {
    backgroundColor: COLORS.primaryPale,
  },
  suggestionItemText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[700],
  },
  suggestionItemTextSelected: {
    color: COLORS.primary,
    fontWeight: '700' as const,
  },

  /* Delete confirm */
  confirmBox: {
    margin: SPACING.xl,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    ...SHADOWS.lg,
  },
  confirmIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  confirmTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '700' as const,
    color: COLORS.gray[900],
    marginBottom: SPACING.sm,
  },
  confirmMsg: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[600],
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmBold: {
    fontWeight: '700' as const,
    color: COLORS.gray[800],
  },
  confirmSub: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.text.muted,
    marginTop: 6,
    marginBottom: SPACING.lg,
  },
  confirmBtns: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
  },
});

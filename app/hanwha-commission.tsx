import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import CompactHeader from '@/components/CompactHeader';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useIdentityGate } from '@/hooks/use-identity-gate';
import { hasHanwhaApprovalEvidence, hasHanwhaPdfMetadata } from '@/lib/fc-workflow';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { openExternalUrl } from '@/lib/open-external-url';
import { supabase } from '@/lib/supabase';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

const BUCKET = 'fc-documents';
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

const formatKoreanDate = (date: Date) =>
  `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`;

const toYMD = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

type HanwhaProfile = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  hanwha_commission_date_sub?: string | null;
  hanwha_commission_date?: string | null;
  hanwha_commission_reject_reason?: string | null;
  hanwha_commission_pdf_path?: string | null;
  hanwha_commission_pdf_name?: string | null;
};

type StatusTone = {
  label: string;
  backgroundColor: string;
  color: string;
};

const trimString = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const resolveFunctionInvokeErrorMessage = async (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: { json?: () => Promise<any> } }).context;
    if (context?.json) {
      const body = await context.json().catch(() => null);
      const message = trimString(body?.message) ?? trimString(body?.error);
      if (message) return message;
    }
  }
  if (error instanceof Error && trimString(error.message)) {
    return error.message;
  }
  return fallback;
};

export default function HanwhaCommissionScreen() {
  const { role, residentId } = useSession();
  useIdentityGate({ nextPath: '/hanwha-commission' });
  const keyboardPadding = useKeyboardPadding();

  const [profile, setProfile] = useState<HanwhaProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
  const [displayDate, setDisplayDate] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!residentId) return;
    const cleanPhone = residentId.replace(/[^0-9]/g, '');
    if (!cleanPhone) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('fc_profiles')
      .select(
        'id,name,status,hanwha_commission_date_sub,hanwha_commission_date,hanwha_commission_reject_reason,hanwha_commission_pdf_path,hanwha_commission_pdf_name',
      )
      .eq('phone', cleanPhone)
      .maybeSingle();
    setLoading(false);

    if (error) {
      Alert.alert('불러오기 실패', error.message ?? '정보를 불러오지 못했습니다.');
      return;
    }

    const nextProfile = (data ?? null) as HanwhaProfile | null;
    setProfile(nextProfile);

    const approvedDate = nextProfile?.hanwha_commission_date
      ? new Date(nextProfile.hanwha_commission_date)
      : null;
    const submittedDate = nextProfile?.hanwha_commission_date_sub
      ? new Date(nextProfile.hanwha_commission_date_sub)
      : null;
    setDisplayDate(approvedDate || submittedDate || null);
  }, [residentId]);

  useEffect(() => {
    load();
  }, [load]);

  const submittedDate = useMemo(
    () => (profile?.hanwha_commission_date_sub ? new Date(profile.hanwha_commission_date_sub) : null),
    [profile?.hanwha_commission_date_sub],
  );
  const approvedDate = useMemo(
    () => (profile?.hanwha_commission_date ? new Date(profile.hanwha_commission_date) : null),
    [profile?.hanwha_commission_date],
  );
  const rejectReason = trimString(profile?.hanwha_commission_reject_reason);
  const pdfPath = trimString(profile?.hanwha_commission_pdf_path);
  const rawPdfName = trimString(profile?.hanwha_commission_pdf_name);
  const pdfName = rawPdfName ?? '한화 위촉 PDF';
  const status = profile?.status ?? null;

  const isApproved = hasHanwhaApprovalEvidence({
    status,
    hanwha_commission_date: approvedDate,
  });
  const canSubmitHanwha = Boolean(
    status === 'docs-approved' ||
    status === 'hanwha-commission-review' ||
    status === 'hanwha-commission-rejected',
  );
  const isRejected = !isApproved && status === 'hanwha-commission-rejected';
  const isPending =
    !isApproved &&
    !isRejected &&
    Boolean(status === 'hanwha-commission-review' || submittedDate);
  const hasApprovedPdf =
    isApproved &&
    hasHanwhaPdfMetadata({
      hanwha_commission_pdf_path: pdfPath,
      hanwha_commission_pdf_name: rawPdfName,
    });
  const isPrerequisiteBlocked = !canSubmitHanwha && !isApproved && !isPending;
  const isLocked = isApproved || isPending || isPrerequisiteBlocked;

  const statusTone = useMemo<StatusTone>(() => {
    if (isPrerequisiteBlocked) {
      return { label: '문서 승인 필요', backgroundColor: '#E0E7FF', color: '#3730A3' };
    }
    if (hasApprovedPdf) {
      return { label: '승인 완료', backgroundColor: '#DCFCE7', color: '#166534' };
    }
    if (isApproved) {
      return { label: 'PDF 대기', backgroundColor: '#FEF3C7', color: '#92400E' };
    }
    if (isRejected) {
      return { label: '반려', backgroundColor: '#FEE2E2', color: '#B91C1C' };
    }
    if (isPending) {
      return { label: '검토 중', backgroundColor: '#FFF7ED', color: '#C2410C' };
    }
    return { label: '입력 전', backgroundColor: COLORS.gray[100], color: COLORS.text.muted };
  }, [hasApprovedPdf, isApproved, isPending, isPrerequisiteBlocked, isRejected]);

  const statusDescription = useMemo(() => {
    if (isPrerequisiteBlocked) return '서류 승인 후 진행';
    if (hasApprovedPdf) return 'PDF 확인 후 다음 단계';
    if (isApproved) return 'PDF 등록 대기';
    if (isRejected) return '반려 후 재제출';
    if (isPending) return '총무 검토 중';
    return 'URL 진행 후 제출';
  }, [hasApprovedPdf, isApproved, isPending, isPrerequisiteBlocked, isRejected]);

  const handleDateChange = useCallback((event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event.type !== 'set' || !selectedDate) return;
    setDisplayDate(selectedDate);
  }, []);

  const submitDate = useCallback(async () => {
    if (!residentId) return;
    if (!displayDate) {
      Alert.alert('날짜 선택', '한화 위촉 완료일을 선택해주세요.');
      return;
    }

    const cleanPhone = residentId.replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      Alert.alert('로그인 정보 없음', '로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
      return;
    }

    setSaving(true);
    const ymd = toYMD(displayDate);

    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        data?: { id?: string; name?: string };
        error?: string;
      }>('fc-submit-hanwha-commission', {
        body: {
          phone: cleanPhone,
          hanwha_commission_date_sub: ymd,
        },
      });

      if (error) {
        const message = await resolveFunctionInvokeErrorMessage(error, '한화 위촉 정보를 저장하지 못했습니다.');
        throw new Error(message);
      }
      if (!data?.ok) {
        throw new Error(data?.message ?? data?.error ?? '한화 위촉 정보를 저장하지 못했습니다.');
      }
      if (!data?.data?.id) {
        throw new Error('업데이트된 데이터가 없습니다. (전화번호 불일치 가능성)');
      }

      await supabase.functions
        .invoke('fc-notify', {
          body: {
            type: 'fc_update',
            fc_id: data.data.id,
            message: `${data.data.name ?? ''}님이 한화 위촉 완료를 보고했습니다. (입력일: ${ymd})`,
            url: '/dashboard',
          },
        })
        .catch(() => undefined);

      Alert.alert('제출 완료', '한화 위촉 완료일이 제출되었습니다.\n총무 승인 후 PDF가 제공됩니다.');
      await load();
    } catch (error: any) {
      Alert.alert('저장 실패', error?.message ?? '한화 위촉 정보를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [displayDate, load, residentId]);

  const resolvePdfUrl = useCallback(async () => {
    if (!pdfPath) {
      throw new Error('열 수 있는 한화 위촉 PDF가 없습니다.');
    }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfPath, 300);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'PDF URL을 생성하지 못했습니다.');
    }
    return data.signedUrl;
  }, [pdfPath]);

  const openPdf = useCallback(async () => {
    if (!pdfPath) {
      Alert.alert('PDF 없음', '열 수 있는 한화 위촉 PDF가 없습니다.');
      return;
    }

    setOpeningPdf(true);
    try {
      const signedUrl = await resolvePdfUrl();
      await openExternalUrl(signedUrl);
    } catch (error: any) {
      Alert.alert('PDF 열기 실패', error?.message ?? '한화 위촉 PDF를 열지 못했습니다.');
    } finally {
      setOpeningPdf(false);
    }
  }, [pdfPath, resolvePdfUrl]);

  const downloadPdf = useCallback(async () => {
    if (!pdfPath) {
      Alert.alert('PDF 없음', '다운로드할 한화 위촉 PDF가 없습니다.');
      return;
    }

    setDownloadingPdf(true);
    try {
      const signedUrl = await resolvePdfUrl();
      const inferredName = (pdfName?.trim() || 'hanwha-commission.pdf').replace(/[\\/:*?"<>|]/g, '_');
      const safeName = inferredName.toLowerCase().endsWith('.pdf') ? inferredName : `${inferredName}.pdf`;
      const tempBaseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!tempBaseDir) {
        throw new Error('다운로드 임시 저장 경로를 찾을 수 없습니다.');
      }

      const downloaded = await FileSystem.downloadAsync(signedUrl, `${tempBaseDir}hanwha-${Date.now()}.pdf`);

      try {
        if (Platform.OS === 'android') {
          const downloadDirUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
          const permission =
            await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(downloadDirUri);

          if (!permission.granted) {
            throw new Error('다운로드 폴더 접근 권한이 필요합니다.');
          }

          const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permission.directoryUri,
            safeName,
            'application/pdf',
          );

          const base64 = await FileSystem.readAsStringAsync(downloaded.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.writeAsStringAsync(destUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else {
          const baseDocDir = FileSystem.documentDirectory;
          if (!baseDocDir) {
            throw new Error('문서 저장 경로를 찾을 수 없습니다.');
          }
          await FileSystem.copyAsync({ from: downloaded.uri, to: `${baseDocDir}${safeName}` });
        }
      } finally {
        await FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);
      }

      Alert.alert('다운로드 완료', `${safeName} 파일을 저장했습니다.`);
    } catch (error: any) {
      Alert.alert('PDF 다운로드 실패', error?.message ?? '한화 위촉 PDF를 다운로드하지 못했습니다.');
    } finally {
      setDownloadingPdf(false);
    }
  }, [pdfName, pdfPath, resolvePdfUrl]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (role !== 'fc') {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={[styles.container, styles.centeredContainer]}>
          <Text style={styles.infoText}>FC 계정으로 로그인하면 이용할 수 있습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '한화 위촉',
          header: (props) => <CompactHeader {...props} />,
        }}
      />

      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: keyboardPadding + 40 }]}
        contentInsetAdjustmentBehavior="never"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenHeader
          title="한화 위촉"
          subtitle="URL · 완료일 · 승인 PDF"
        />

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.summaryHeader}>
                <Text style={styles.sectionTitle}>한화 위촉 검토</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusTone.backgroundColor }]}>
                  <Text style={[styles.statusBadgeText, { color: statusTone.color }]}>{statusTone.label}</Text>
                </View>
              </View>
              <Text style={styles.sectionDesc}>{statusDescription}</Text>
              {isPrerequisiteBlocked && (
                <Text style={[styles.sectionDesc, { color: COLORS.text.muted, marginTop: 4 }]}>
                  서류 승인 후 총무가 URL을 안내합니다.
                </Text>
              )}
              {!!rejectReason && (
                <View style={styles.rejectBox}>
                  <Text style={styles.rejectTitle}>반려 사유</Text>
                  <Text style={styles.rejectText}>{rejectReason}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>한화 위촉 완료일</Text>
                {Platform.OS === 'web' ? (
                  <View style={styles.webDateWrapper}>
                    <View style={[styles.dateInput, isLocked && styles.disabledInput]}>
                      <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                        {displayDate ? formatShortKoreanDate(displayDate) : '날짜를 선택하세요'}
                      </Text>
                      <Feather name="calendar" size={18} color={COLORS.text.secondary} />
                    </View>
                    {/* @ts-ignore */}
                    <input
                      type="date"
                      style={styles.webDateInput}
                      value={displayDate ? toYMD(displayDate) : ''}
                      disabled={isLocked}
                      onChange={(event: any) => {
                        if (isLocked) return;
                        const nextDate = event.target.valueAsDate;
                        if (nextDate) {
                          handleDateChange({ type: 'set' } as DateTimePickerEvent, nextDate);
                        }
                      }}
                    />
                  </View>
                ) : (
                  <Pressable
                    style={[styles.dateInput, isLocked && styles.disabledInput]}
                    onPress={() => {
                      if (isLocked) return;
                      setTempDate(displayDate ?? new Date());
                      setShowPicker(true);
                    }}
                  >
                    <Text style={[styles.dateText, !displayDate && styles.placeholderText]}>
                      {displayDate ? formatKoreanDate(displayDate) : '날짜를 선택하세요'}
                    </Text>
                    <Feather name="calendar" size={18} color={COLORS.text.secondary} />
                  </Pressable>
                )}

                {showPicker && Platform.OS === 'android' && (
                  <DateTimePicker
                    value={displayDate ?? new Date()}
                    mode="date"
                    onChange={handleDateChange}
                  />
                )}
              </View>

              <Button
                onPress={submitDate}
                disabled={isLocked || !displayDate || saving}
                loading={saving}
                variant="primary"
                size="lg"
                fullWidth
                style={{ marginTop: 8 }}
              >
                {isApproved ? '승인 완료' : isPending ? '승인 대기 중' : '완료일 제출하기'}
              </Button>
              {!!pdfPath && <Text style={styles.fileCaption}>{pdfName}</Text>}

              {hasApprovedPdf && (
                <Button
                  onPress={openPdf}
                  loading={openingPdf}
                  variant="outline"
                  size="lg"
                  fullWidth
                  leftIcon={<Feather name="download" size={18} color={COLORS.primary} />}
                >
                  승인 PDF 확인
                </Button>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.compactHero}>
                <View style={[styles.heroIconWrap, styles.heroIconWrapSolid]}>
                  <Feather name="file-text" size={20} color={COLORS.white} />
                </View>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.sectionTitle}>승인 PDF</Text>
                  <Text style={styles.sectionDesc}>
                    {hasApprovedPdf ? '열람 · 다운로드 후 다음 단계' : '총무 승인 후 이곳에 PDF가 도착합니다.'}
                  </Text>
                </View>
              </View>

              <View style={[styles.pdfDock, hasApprovedPdf ? styles.pdfDockReady : styles.pdfDockPending]}>
                <View style={styles.pdfDockMain}>
                  <View style={[styles.pdfPreviewBadge, hasApprovedPdf ? styles.pdfPreviewBadgeReady : styles.pdfPreviewBadgePending]}>
                    <Feather
                      name={hasApprovedPdf ? 'file-text' : 'download-cloud'}
                      size={22}
                      color={hasApprovedPdf ? COLORS.primary : COLORS.text.disabled}
                    />
                  </View>
                  <View style={styles.pdfDockTextWrap}>
                    <Text style={styles.pdfDockTitle}>
                      {hasApprovedPdf ? '한화 위촉 승인 PDF' : 'PDF 도착 대기'}
                    </Text>
                    <Text style={styles.pdfDockDesc}>
                      {hasApprovedPdf ? pdfName : '총무가 승인 후 PDF를 등록하면 여기서 바로 확인할 수 있습니다.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.pdfActions}>
                  <Button
                    onPress={openPdf}
                    loading={openingPdf}
                    disabled={!hasApprovedPdf}
                    variant={hasApprovedPdf ? 'outline' : 'outline'}
                    size="md"
                    style={styles.pdfActionBtn}
                    leftIcon={<Feather name="eye" size={16} color={hasApprovedPdf ? COLORS.primary : COLORS.text.disabled} />}
                  >
                    열람
                  </Button>
                  <Button
                    onPress={downloadPdf}
                    loading={downloadingPdf}
                    disabled={!hasApprovedPdf}
                    variant={hasApprovedPdf ? 'secondary' : 'outline'}
                    size="md"
                    style={styles.pdfActionBtn}
                    leftIcon={<Feather name="download" size={16} color={hasApprovedPdf ? COLORS.white : COLORS.text.disabled} />}
                  >
                    다운로드
                  </Button>
                </View>

              </View>
            </View>
          </>
        )}
      </ScrollView>

      {Platform.OS === 'ios' && showPicker && (
        <Modal visible transparent animationType="slide">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={tempDate ?? displayDate ?? new Date()}
                mode="date"
                display="inline"
                locale="ko-KR"
                onChange={(_, nextDate) => {
                  if (nextDate) {
                    setTempDate(nextDate);
                  }
                }}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnGhost]}
                  onPress={() => {
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  <Text style={styles.pickerBtnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[styles.pickerBtn, styles.pickerBtnPrimary]}
                  onPress={() => {
                    if (tempDate) {
                      setDisplayDate(tempDate);
                    }
                    setShowPicker(false);
                    setTempDate(null);
                  }}
                >
                  <Text style={styles.pickerBtnPrimaryText}>확인</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 0,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  centeredContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.lg,
    gap: SPACING.base,
    ...SHADOWS.base,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  sectionTitle: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
  },
  sectionDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: COLORS.text.muted,
    lineHeight: 20,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.base,
  },
  statusBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  statusHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
  },
  statusHintText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    lineHeight: 18,
  },
  detailList: {
    gap: SPACING.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.base,
  },
  detailLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  detailLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
  },
  fileCaption: {
    fontSize: TYPOGRAPHY.fontSize.xs + 1,
    color: COLORS.text.muted,
  },
  pdfDock: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  pdfDockReady: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  pdfDockPending: {
    backgroundColor: COLORS.background.secondary,
    borderColor: COLORS.border.light,
    borderStyle: 'dashed',
  },
  pdfDockMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pdfPreviewBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfPreviewBadgeReady: {
    backgroundColor: '#FFE7D1',
  },
  pdfPreviewBadgePending: {
    backgroundColor: COLORS.white,
  },
  pdfDockTextWrap: {
    flex: 1,
    gap: 4,
  },
  pdfDockTitle: {
    fontSize: TYPOGRAPHY.fontSize.base + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
  },
  pdfDockDesc: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.muted,
    lineHeight: 19,
  },
  pdfActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  pdfActionBtn: {
    flex: 1,
  },
  rejectBox: {
    backgroundColor: COLORS.errorLight,
    borderColor: '#FECACA',
    borderWidth: 1,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  rejectTitle: {
    fontSize: TYPOGRAPHY.fontSize.md + 1,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: '#B91C1C',
    marginBottom: SPACING.xs + 2,
  },
  rejectText: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    color: '#7F1D1D',
    lineHeight: 24,
  },
  inputGroup: {
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.text.primary,
  },
  webDateWrapper: {
    position: 'relative',
    width: '100%',
  },
  webDateInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  } as any,
  dateInput: {
    minHeight: 48,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: SPACING.sm + 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  disabledInput: {
    backgroundColor: COLORS.gray[100],
    opacity: 0.7,
  },
  dateText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
  },
  placeholderText: {
    color: COLORS.text.disabled,
  },
  infoText: {
    color: COLORS.text.muted,
    fontSize: TYPOGRAPHY.fontSize.sm + 1,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: COLORS.white,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.base,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  pickerBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.base + 2,
  },
  pickerBtnGhost: {
    backgroundColor: COLORS.gray[100],
  },
  pickerBtnPrimary: {
    backgroundColor: COLORS.gray[700],
  },
  pickerBtnGhostText: {
    color: COLORS.text.primary,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  pickerBtnPrimaryText: {
    color: COLORS.white,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
});

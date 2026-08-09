import { Feather } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { getExamPaymentProofViewUrl } from '@/lib/exam-payment-proof-api';

const ORANGE = '#f36f21';

type Props = {
  appSessionToken: string | null | undefined;
  registrationId: string;
  targetFcId?: string | null;
};

export function ExamPaymentProofHistoryButton({
  appSessionToken,
  registrationId,
  targetFcId,
}: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const openPreview = useCallback(async () => {
    if (isLoading) return;
    if (!appSessionToken?.trim()) {
      Alert.alert('입금 내역 확인', '입금 내역을 확인하려면 다시 로그인해주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await getExamPaymentProofViewUrl(
        appSessionToken,
        registrationId,
        targetFcId,
      );
      setSignedUrl(result.signedUrl);
      setIsPreviewVisible(true);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : '입금 내역 이미지를 불러오지 못했습니다.';
      Alert.alert('입금 내역 확인', message);
    } finally {
      setIsLoading(false);
    }
  }, [appSessionToken, isLoading, registrationId, targetFcId]);

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="첨부한 입금 내역 이미지 보기"
        accessibilityHint="선택한 시험 신청에 첨부한 입금 내역 이미지를 전체 화면으로 엽니다."
        disabled={isLoading}
        onPress={() => {
          void openPreview();
        }}
        style={({ pressed }) => [
          styles.button,
          pressed && !isLoading && styles.pressed,
          isLoading && styles.disabled,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={ORANGE} />
        ) : (
          <Feather name="image" size={17} color={ORANGE} />
        )}
        <Text style={styles.buttonText}>
          {isLoading ? '불러오는 중...' : '입금 내역 보기'}
        </Text>
      </Pressable>

      <ImagePreviewModal
        visible={isPreviewVisible}
        images={signedUrl ? [{ url: signedUrl, title: '첨부한 입금 내역' }] : []}
        onClose={() => setIsPreviewVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-end',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    color: ORANGE,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.6,
  },
});

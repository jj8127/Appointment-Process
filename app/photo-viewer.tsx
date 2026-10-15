import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage } from '@/components/ImagePreviewModal';
import { goBackOrReplace } from '@/lib/back-navigation';
import { logger } from '@/lib/logger';
import { getMessengerAttachmentSignedUrl } from '@/lib/messenger-attachment-actions';
import { downloadRemoteFileToUserStorage } from '@/lib/native-file-actions';

const HEADER_HEIGHT = 56;

/**
 * Full-screen photo for a messenger attachment. A regular screen rather than a
 * native Modal, so pinch zoom also works on Android (gesture views inside a
 * native Modal crashed there; see components/image-preview-modal-policy.ts).
 */
export default function PhotoViewerScreen() {
  const params = useLocalSearchParams<{ attachmentId?: string; name?: string; mimeType?: string }>();
  const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : '';
  const name = typeof params.name === 'string' && params.name ? params.name : '사진';
  const mimeType = typeof params.mimeType === 'string' && params.mimeType ? params.mimeType : 'image/jpeg';
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!attachmentId) { setFailed(true); return undefined; }
    getMessengerAttachmentSignedUrl(attachmentId)
      .then((url) => { if (active) setUri(url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachmentId]);

  const close = () => goBackOrReplace(router, '/messenger');

  const save = async () => {
    if (saving || !attachmentId) return;
    setSaving(true);
    try {
      const url = await getMessengerAttachmentSignedUrl(attachmentId);
      await downloadRemoteFileToUserStorage({
        url,
        fileName: name,
        mimeType,
        tempPrefix: 'messenger-photo',
        fallbackFileName: `photo-${attachmentId}`,
      });
      Alert.alert('저장 완료', '사진을 저장했어요.');
    } catch (error) {
      logger.warn('[messenger] photo save failed', { message: error instanceof Error ? error.message : 'unknown' });
      Alert.alert('저장 실패', error instanceof Error && error.message ? error.message : '사진을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const pageHeight = Math.max(height - insets.top - insets.bottom - HEADER_HEIGHT, 1);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={8}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Feather name="x" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{name}</Text>
        <Pressable onPress={() => void save()} accessibilityRole="button" accessibilityLabel="사진 저장" disabled={saving || !uri} hitSlop={8}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Feather name="download" size={22} color="#fff" />}
        </Pressable>
      </View>
      <View style={[styles.body, { paddingBottom: insets.bottom }]}>
        {uri ? (
          <ZoomableImage uri={uri} pageWidth={width} pageHeight={pageHeight} isZoomed={zoomed} onZoomStateChange={setZoomed} />
        ) : failed ? (
          <Text style={styles.message}>사진을 불러오지 못했어요.</Text>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  headerButton: { width: 44, height: HEADER_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { color: '#fff', fontSize: 15 },
});

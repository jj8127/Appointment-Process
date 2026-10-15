import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logger } from '@/lib/logger';
import { getMessengerAttachmentSignedUrl } from '@/lib/messenger-attachment-actions';
import type { MessengerAttachmentMetadata } from '@/lib/messenger-attachment-api';
import { downloadRemoteFileToUserStorage } from '@/lib/native-file-actions';
import { COLORS } from '@/lib/theme';

const PREVIEW_WIDTH = 220;
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.8;

/**
 * Inline preview for a private image attachment that opens a full-screen viewer
 * inside the app. The image is cached on the device under the attachment id, so
 * a cached photo is shown without asking the server for a fresh signed URL.
 * Falls back to the file card when the preview cannot load.
 */
export default function MessengerImageAttachment({
  attachment,
  fallback,
}: {
  attachment: MessengerAttachmentMetadata;
  fallback: ReactNode;
}) {
  const cacheKey = `messenger-attachment:${attachment.id}`;
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setUri(null);
    setFailed(false);
    (async () => {
      try {
        const cachedPath = await Image.getCachePathAsync(cacheKey).catch(() => null);
        const next = cachedPath
          ? (cachedPath.startsWith('file://') ? cachedPath : `file://${cachedPath}`)
          : await getMessengerAttachmentSignedUrl(attachment.id);
        if (active) setUri(next);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [attachment.id, cacheKey]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url = await getMessengerAttachmentSignedUrl(attachment.id);
      await downloadRemoteFileToUserStorage({
        url,
        fileName: attachment.name,
        mimeType: attachment.mimeType,
        tempPrefix: 'messenger-photo',
        fallbackFileName: `photo-${attachment.id}`,
      });
      Alert.alert('저장 완료', '사진을 저장했어요.');
    } catch (error) {
      logger.warn('[messenger] photo save failed', { message: error instanceof Error ? error.message : 'unknown' });
      Alert.alert('저장 실패', error instanceof Error && error.message ? error.message : '사진을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  if (failed) return <>{fallback}</>;
  return (
    <>
      <Pressable
        onPress={() => { if (uri) setViewerOpen(true); }}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${attachment.name} 사진 크게 보기`}
        style={({ pressed }) => [styles.frame, { aspectRatio: ratio }, pressed && styles.pressed]}
      >
        {uri ? (
          <Image
            source={{ uri, cacheKey }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="disk"
            transition={150}
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) {
                setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, source.width / source.height)));
              }
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={COLORS.gray[500]} />
          </View>
        )}
      </Pressable>
      <Modal
        visible={viewerOpen}
        animationType="fade"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setViewerOpen(false)}
      >
        <View style={styles.viewer}>
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {uri ? (
              <Image
                source={{ uri, cacheKey }}
                style={{ width: window.width, height: window.height }}
                contentFit="contain"
                cachePolicy="disk"
                accessibilityLabel={attachment.name}
              />
            ) : null}
          </ScrollView>
          <View style={[styles.viewerBar, { paddingTop: insets.top + 8 }]}>
            <Pressable
              onPress={() => setViewerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="닫기"
              hitSlop={8}
              style={({ pressed }) => [styles.viewerButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={24} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityLabel="사진 저장"
              disabled={saving}
              hitSlop={8}
              style={({ pressed }) => [styles.viewerButton, pressed && styles.pressed]}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Feather name="download" size={22} color="#fff" />}
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { width: PREVIEW_WIDTH, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: COLORS.gray[100] },
  pressed: { opacity: 0.7 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  viewerBar: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.35)' },
  viewerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { getMessengerAttachmentSignedUrl } from '@/lib/messenger-attachment-actions';
import type { MessengerAttachmentMetadata } from '@/lib/messenger-attachment-api';
import { COLORS } from '@/lib/theme';

const PREVIEW_WIDTH = 220;
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.8;

/**
 * Inline preview for a private image attachment. The image is cached on the
 * device under the attachment id, so a cached photo is shown without asking
 * the server for a fresh signed URL. Falls back to the file card on failure.
 */
export default function MessengerImageAttachment({
  attachment,
  onPress,
  fallback,
}: {
  attachment: MessengerAttachmentMetadata;
  onPress: () => void;
  fallback: ReactNode;
}) {
  const cacheKey = `messenger-attachment:${attachment.id}`;
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1);

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

  if (failed) return <>{fallback}</>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${attachment.name} 사진 열기`}
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
  );
}

const styles = StyleSheet.create({
  frame: { width: PREVIEW_WIDTH, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: COLORS.gray[100] },
  pressed: { opacity: 0.85 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});

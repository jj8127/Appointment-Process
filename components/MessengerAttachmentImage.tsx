import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { useMessengerImagePreview } from '@/hooks/use-messenger-image-preview';

type Props = {
  attachmentId: string;
  onLongPress: () => void;
};

export function MessengerAttachmentImage({ attachmentId, onLongPress }: Props) {
  const preview = useMessengerImagePreview(attachmentId);
  const { width: windowWidth } = useWindowDimensions();
  const [dimensions, setDimensions] = useState<{ url: string; ratio: number } | null>(null);
  const maxWidth = Math.min(240, Math.max(120, windowWidth - 132));
  const ratio = dimensions?.url === preview.url ? dimensions.ratio : 1;
  const height = Math.min(380, maxWidth / ratio);
  const width = Math.min(maxWidth, height * ratio);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preview.failed ? '사진 다시 불러오기' : '사진 크게 보기'}
        accessibilityHint="길게 누르면 메시지 메뉴를 엽니다."
        disabled={preview.loading}
        onPress={preview.failed ? preview.retry : preview.open}
        onLongPress={onLongPress}
        delayLongPress={220}
        style={[styles.frame, { width, height }]}
      >
        {preview.url ? (
          <Image
            source={{ uri: preview.url }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            cachePolicy="none"
            recyclingKey={attachmentId}
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0 && preview.url) {
                setDimensions({ url: preview.url, ratio: source.width / source.height });
              }
            }}
            onError={preview.imageFailed}
          />
        ) : null}
        {preview.loading ? <ActivityIndicator color="#f36f21" /> : null}
        {preview.failed ? (
          <View style={styles.feedback}>
            <Feather name="image" size={28} color="#6B7280" />
            <Text style={styles.feedbackText}>사진을 불러오지 못했습니다.</Text>
            <Text style={styles.retryText}>탭하여 다시 시도</Text>
          </View>
        ) : null}
      </Pressable>
      {preview.visible && preview.url ? (
        <ImagePreviewModal
          visible
          images={[{ url: preview.url }]}
          onClose={preview.close}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  feedback: { alignItems: 'center', gap: 8, padding: 12 },
  feedbackText: { fontSize: 12, color: '#4B5563', textAlign: 'center' },
  retryText: { fontSize: 12, color: '#f36f21', fontWeight: '600' },
});

import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type PreviewImageItem = {
  url: string;
  title?: string;
};

type ImagePreviewModalProps = {
  visible: boolean;
  images: PreviewImageItem[];
  initialIndex?: number;
  onClose: () => void;
};

const OVERLAY_HORIZONTAL_PADDING = 16;

const clampIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
};

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.min(Math.max(value, min), max);
};

type ZoomableImageProps = {
  uri: string;
  pageWidth: number;
  pageHeight: number;
  isZoomed: boolean;
  onZoomStateChange: (zoomed: boolean) => void;
};

function ZoomableImage({ uri, pageWidth, pageHeight, isZoomed, onZoomStateChange }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (zoomed, prev) => {
      if (zoomed !== prev) {
        runOnJS(onZoomStateChange)(zoomed);
      }
    },
    [onZoomStateChange],
  );

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      baseScale.value = scale.value;
    })
    .onUpdate((event) => {
      const nextScale = clamp(baseScale.value * event.scale, 1, 4);
      scale.value = nextScale;
      if (nextScale <= 1.01) {
        translateX.value = 0;
        translateY.value = 0;
        return;
      }

      const maxX = ((pageWidth * nextScale) - pageWidth) / 2;
      const maxY = ((pageHeight * nextScale) - pageHeight) / 2;
      translateX.value = clamp(translateX.value, -maxX, maxX);
      translateY.value = clamp(translateY.value, -maxY, maxY);
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        runOnJS(onZoomStateChange)(false);
      } else {
        runOnJS(onZoomStateChange)(true);
      }
      baseScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .enabled(isZoomed)
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1.01) return;
      const maxX = ((pageWidth * scale.value) - pageWidth) / 2;
      const maxY = ((pageHeight * scale.value) - pageHeight) / 2;
      translateX.value = clamp(startX.value + event.translationX, -maxX, maxX);
      translateY.value = clamp(startY.value + event.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        runOnJS(onZoomStateChange)(false);
      }
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);
  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  useEffect(() => {
    return () => onZoomStateChange(false);
  }, [onZoomStateChange]);

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={[styles.zoomFrame, { width: pageWidth, height: pageHeight }]}>
        <Animated.View style={animatedImageStyle}>
          <Image source={{ uri }} style={[styles.image, { width: pageWidth, height: pageHeight }]} resizeMode="contain" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export function ImagePreviewModal({ visible, images, initialIndex = 0, onClose }: ImagePreviewModalProps) {
  const { width, height } = useWindowDimensions();
  const pageWidth = Math.max(width - OVERLAY_HORIZONTAL_PADDING * 2, 1);
  const defaultBodyHeight = Math.max(height - 140, 1);
  const listRef = useRef<FlatList<PreviewImageItem>>(null);
  const safeImages = useMemo(() => images.filter((item) => !!item?.url), [images]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(defaultBodyHeight);
  const [isZoomed, setIsZoomed] = useState(false);
  const totalCount = safeImages.length;
  const startIndex = clampIndex(initialIndex, totalCount);

  useEffect(() => {
    if (!visible) return;
    setIsZoomed(false);
  }, [currentIndex, visible]);

  useEffect(() => {
    setBodyHeight(defaultBodyHeight);
  }, [defaultBodyHeight]);

  useEffect(() => {
    if (!visible) return;
    setCurrentIndex(startIndex);
    setIsZoomed(false);
    if (totalCount === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: startIndex * pageWidth, animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [pageWidth, startIndex, totalCount, visible]);

  const handleMomentumEnd = useCallback((offsetX: number) => {
    if (pageWidth <= 0 || totalCount === 0) return;
    const nextIndex = clampIndex(Math.round(offsetX / pageWidth), totalCount);
    setCurrentIndex(nextIndex);
  }, [pageWidth, totalCount]);

  const handleBodyLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.max(event.nativeEvent.layout.height, 1);
    if (nextHeight !== bodyHeight) {
      setBodyHeight(nextHeight);
    }
  };

  const currentTitle = safeImages[currentIndex]?.title?.trim() || '이미지 미리보기';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title} numberOfLines={1}>{currentTitle}</Text>
              {totalCount > 0 && (
                <Text style={styles.indexText}>{`총 ${totalCount}장 중 ${currentIndex + 1}번째`}</Text>
              )}
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Feather name="x" size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.body} onLayout={handleBodyLayout}>
            {totalCount > 0 ? (
              <FlatList
                ref={listRef}
                data={safeImages}
                keyExtractor={(item, index) => `${item.url}-${index}`}
                horizontal
                pagingEnabled
                scrollEnabled={!isZoomed}
                showsHorizontalScrollIndicator={false}
                initialNumToRender={1}
                maxToRenderPerBatch={2}
                windowSize={3}
                getItemLayout={(_data, index) => ({
                  length: pageWidth,
                  offset: pageWidth * index,
                  index,
                })}
                onMomentumScrollEnd={(event) => {
                  handleMomentumEnd(event.nativeEvent.contentOffset.x);
                }}
                renderItem={({ item }) => (
                  <View style={[styles.imagePage, { width: pageWidth, height: bodyHeight }]}>
                    <ZoomableImage
                      uri={item.url}
                      pageWidth={pageWidth}
                      pageHeight={bodyHeight}
                      isZoomed={isZoomed}
                      onZoomStateChange={setIsZoomed}
                    />
                  </View>
                )}
              />
            ) : (
              <Text style={styles.emptyText}>이미지를 불러올 수 없습니다.</Text>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: OVERLAY_HORIZONTAL_PADDING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  indexText: {
    marginTop: 2,
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  body: {
    flex: 1,
  },
  imagePage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
  },
  emptyText: {
    color: '#d1d5db',
    fontSize: 14,
  },
});

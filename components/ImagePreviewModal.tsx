import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
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

import {
  shouldEnableModalImageGestures,
  shouldVirtualizeModalImages,
} from './image-preview-modal-policy';

export type PreviewImageItem = {
  url: string;
  title?: string;
};

type ImagePreviewModalProps = {
  visible: boolean;
  images: PreviewImageItem[];
  initialIndex?: number;
  onClose: () => void;
  /** Shows a save button for the image on screen; callers without saving omit it. */
  onSave?: (index: number) => void;
  saving?: boolean;
};

const OVERLAY_HORIZONTAL_PADDING = 16;
const DOUBLE_TAP_SCALE = 2.5;
// The Android pager is not virtualized, so only the visible page and its neighbours load an image.
const STATIC_PAGE_WINDOW = 1;

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

type PreviewImageLoadState = 'loading' | 'loaded' | 'failed';

// An expired signed URL or a slow large image otherwise leaves only the black overlay on screen.
// Android decodes remote images at full size unless resizeMethod="resize"; the non-virtualized Android pager
// mounts every page at once, so several camera photos could exhaust memory and fail to draw.
function usePreviewImageLoadState(uri: string) {
  const [loadState, setLoadState] = useState<PreviewImageLoadState>('loading');
  useEffect(() => {
    setLoadState('loading');
  }, [uri]);
  const imageProps = useMemo(() => ({
    onLoad: () => setLoadState('loaded'),
    onError: () => setLoadState('failed'),
  }), []);
  return { loadState, imageProps };
}

function PreviewImageStatus({ loadState }: { loadState: PreviewImageLoadState }) {
  if (loadState === 'loaded') return null;
  return (
    <View pointerEvents="none" style={styles.imageStatus}>
      {loadState === 'loading' ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.emptyText}>이미지를 불러올 수 없습니다.</Text>
      )}
    </View>
  );
}

function StaticPreviewImage({ uri, pageWidth, pageHeight }: Pick<ZoomableImageProps, 'uri' | 'pageWidth' | 'pageHeight'>) {
  const { loadState, imageProps } = usePreviewImageLoadState(uri);
  return (
    <View style={[styles.zoomFrame, { width: pageWidth, height: pageHeight }]}>
      <Image source={{ uri }} style={[styles.image, { width: pageWidth, height: pageHeight }]} resizeMode="contain" resizeMethod="resize" {...imageProps} />
      <PreviewImageStatus loadState={loadState} />
    </View>
  );
}

/** Pinch/double-tap zoom and pan image. On Android use it in a regular screen, not inside a native Modal (see image-preview-modal-policy). */
export function ZoomableImage({ uri, pageWidth, pageHeight, isZoomed, onZoomStateChange }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const { loadState, imageProps } = usePreviewImageLoadState(uri);

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

  // Double tap toggles between fit and DOUBLE_TAP_SCALE, keeping the tapped point under the finger.
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        baseScale.value = 1;
        runOnJS(onZoomStateChange)(false);
        return;
      }
      const maxX = ((pageWidth * DOUBLE_TAP_SCALE) - pageWidth) / 2;
      const maxY = ((pageHeight * DOUBLE_TAP_SCALE) - pageHeight) / 2;
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      translateX.value = withTiming(clamp((1 - DOUBLE_TAP_SCALE) * (event.x - pageWidth / 2), -maxX, maxX));
      translateY.value = withTiming(clamp((1 - DOUBLE_TAP_SCALE) * (event.y - pageHeight / 2), -maxY, maxY));
      baseScale.value = DOUBLE_TAP_SCALE;
      runOnJS(onZoomStateChange)(true);
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);
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
          <Image source={{ uri }} style={[styles.image, { width: pageWidth, height: pageHeight }]} resizeMode="contain" resizeMethod="resize" {...imageProps} />
        </Animated.View>
        <PreviewImageStatus loadState={loadState} />
      </View>
    </GestureDetector>
  );
}

export function ImagePreviewModal({ visible, images, initialIndex = 0, onClose, onSave, saving }: ImagePreviewModalProps) {
  const { width, height } = useWindowDimensions();
  const pageWidth = Math.max(width - OVERLAY_HORIZONTAL_PADDING * 2, 1);
  const defaultBodyHeight = Math.max(height - 140, 1);
  const listRef = useRef<FlatList<PreviewImageItem>>(null);
  const scrollRef = useRef<ScrollView>(null);
  const safeImages = useMemo(() => images.filter((item) => !!item?.url), [images]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(defaultBodyHeight);
  const [isZoomed, setIsZoomed] = useState(false);
  const totalCount = safeImages.length;
  const startIndex = clampIndex(initialIndex, totalCount);
  const enableModalImageGestures = shouldEnableModalImageGestures(Platform.OS);
  const virtualizeModalImages = shouldVirtualizeModalImages(Platform.OS);
  const ModalRootView = enableModalImageGestures ? GestureHandlerRootView : View;

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
      scrollRef.current?.scrollTo({ x: startIndex * pageWidth, y: 0, animated: false });
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
      <ModalRootView style={styles.gestureRoot}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title} numberOfLines={1}>{currentTitle}</Text>
              {totalCount > 0 && (
                <Text style={styles.indexText}>{`총 ${totalCount}장 중 ${currentIndex + 1}번째`}</Text>
              )}
            </View>
            {onSave && totalCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="사진 저장"
                accessibilityState={{ busy: !!saving, disabled: !!saving }}
                disabled={saving}
                style={({ pressed }) => [styles.closeButton, (pressed || saving) && { opacity: 0.7 }]}
                onPress={() => onSave(currentIndex)}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather aria-hidden accessible={false} name="download" size={20} color="#fff" />}
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="사진 미리보기 닫기"
              style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Feather aria-hidden accessible={false} name="x" size={20} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.body} onLayout={handleBodyLayout}>
            {totalCount > 0 && virtualizeModalImages ? (
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
            ) : totalCount > 0 ? (
              <ScrollView
                ref={scrollRef}
                contentOffset={{ x: startIndex * pageWidth, y: 0 }}
                horizontal
                pagingEnabled
                scrollEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  handleMomentumEnd(event.nativeEvent.contentOffset.x);
                }}
              >
                {safeImages.map((item, index) => (
                  <View key={`${item.url}-${index}`} style={[styles.imagePage, { width: pageWidth, height: bodyHeight }]}>
                    {Math.abs(index - currentIndex) <= STATIC_PAGE_WINDOW && (
                      <StaticPreviewImage
                        uri={item.url}
                        pageWidth={pageWidth}
                        pageHeight={bodyHeight}
                      />
                    )}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.emptyText}>이미지를 불러올 수 없습니다.</Text>
            )}
          </View>
        </View>
      </ModalRootView>
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
    gap: 8,
    marginBottom: 12,
  },
  headerTextWrap: {
    flex: 1,
    marginRight: 4,
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
  imageStatus: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#d1d5db',
    fontSize: 14,
  },
});

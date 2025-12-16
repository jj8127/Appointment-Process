import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Image,
    ImageSourcePropType,
    LayoutChangeEvent,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TourStep {
    x: number; // 0-100 (image area 기준)
    y: number; // 0-100 (image area 기준)
    width?: number; // 0-100 (image area 기준)
    height?: number; // 0-100 (image area 기준)
    title: string;
    description: string;
    tooltipPosition?: 'top' | 'bottom';
}

interface ImageTourGuideProps {
    visible: boolean;
    onClose: () => void;
    imageSource: ImageSourcePropType;
    steps: TourStep[];
}

type Size = { w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const ORANGE_PREMIUM = {
    dim: 0.60,
    move: { type: 'spring' as const, damping: 20, stiffness: 240, mass: 0.9 },
    tooltip: { type: 'spring' as const, damping: 22, stiffness: 260, mass: 0.75 },
    tooltipWidth: 320,
    tooltipPadding: 22,
    tooltipRadius: 22,
    tooltipBg: 'rgba(255,255,255,0.94)',
    tooltipShadowOpacity: 0.18,
    tooltipShadowRadius: 20,
    tooltipElevation: 12,
    pulseDuration: 1200,
};

export const ImageTourGuide = ({
    visible,
    onClose,
    imageSource,
    steps,
}: ImageTourGuideProps) => {
    const insets = useSafeAreaInsets();

    // “툴팁 out → step 변경 → 툴팁 in” 전환을 위한 상태
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [tooltipPhase, setTooltipPhase] = useState<'in' | 'out'>('in');
    const [pulseKey, setPulseKey] = useState(0);

    // 레이아웃 측정(이미지 contain 보정용)
    const [wrapperSize, setWrapperSize] = useState<Size>({ w: 0, h: 0 });
    const [imgSize, setImgSize] = useState<Size>({ w: 0, h: 0 });
    const [tooltipSize, setTooltipSize] = useState<Size>({ w: 320, h: 160 });

    const closeRequestedRef = useRef(false);

    const currentStep = steps[currentStepIndex];
    const isLastStep = currentStepIndex === steps.length - 1;

    // 열릴 때 스텝 리셋
    useEffect(() => {
        if (visible) {
            closeRequestedRef.current = false;
            setCurrentStepIndex(0);
            setTooltipPhase('in');
            setPulseKey(0);
        }
    }, [visible]);

    // 이미지 원본 사이즈 확보 (require/uri 모두 대응)
    useEffect(() => {
        const resolved = Image.resolveAssetSource(imageSource as any);
        if (resolved?.width && resolved?.height) {
            setImgSize({ w: resolved.width, h: resolved.height });
            return;
        }

        // uri인 경우
        const uri = (imageSource as any)?.uri;
        if (uri) {
            Image.getSize(
                uri,
                (w, h) => setImgSize({ w, h }),
                () => setImgSize({ w: 0, h: 0 })
            );
        }
    }, [imageSource]);

    const onWrapperLayout = (e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setWrapperSize({ w: width, h: height });
    };

    /**
     * contain 렌더링에서 실제 이미지가 차지하는 “표시 영역 rect”
     * - wrapper 안에서 scale=min(w/imgW, h/imgH)
     * - 중앙정렬 offset 계산
     */
    const imageRect: Rect | null = useMemo(() => {
        if (!wrapperSize.w || !wrapperSize.h || !imgSize.w || !imgSize.h) return null;

        const scale = Math.min(wrapperSize.w / imgSize.w, wrapperSize.h / imgSize.h);
        const w = imgSize.w * scale;
        const h = imgSize.h * scale;
        const x = (wrapperSize.w - w) / 2;
        const y = (wrapperSize.h - h) / 2;
        return { x, y, w, h };
    }, [wrapperSize, imgSize]);

    // step(%) → px rect 변환
    const highlightRect: Rect | null = useMemo(() => {
        if (!currentStep || !imageRect) return null;

        const cx = imageRect.x + imageRect.w * (currentStep.x / 100);
        const cy = imageRect.y + imageRect.h * (currentStep.y / 100);

        const w = currentStep.width ? imageRect.w * (currentStep.width / 100) : 28;
        const h = currentStep.height ? imageRect.h * (currentStep.height / 100) : 28;

        const x = cx - w / 2;
        const y = cy - h / 2;

        // 화면 밖으로 튀지 않게 살짝 클램프
        const pad = 6;
        return {
            x: clamp(x, pad, wrapperSize.w - w - pad),
            y: clamp(y, pad, wrapperSize.h - h - pad),
            w,
            h,
        };
    }, [currentStep, imageRect, wrapperSize]);

    const anchor = useMemo(() => {
        if (!highlightRect) return { x: wrapperSize.w / 2, y: wrapperSize.h / 2 };
        return { x: highlightRect.x + highlightRect.w / 2, y: highlightRect.y + highlightRect.h / 2 };
    }, [highlightRect, wrapperSize]);

    // 툴팁 위치 계산(오버플로우 시 자동 플립)
    const tooltipPos = useMemo(() => {
        const margin = 16;
        const minX = 16;
        const maxX = Math.max(16, wrapperSize.w - tooltipSize.w - 16);

        let left = clamp(anchor.x - tooltipSize.w / 2, minX, maxX);

        // 기본: step이 원하는 방향
        const wantTop = currentStep?.tooltipPosition === 'top';

        const topCandidate = (highlightRect?.y ?? anchor.y) - tooltipSize.h - margin;
        const bottomCandidate = (highlightRect ? highlightRect.y + highlightRect.h : anchor.y) + margin;

        // 화면에 더 잘 들어오는 쪽 선택
        let top = wantTop ? topCandidate : bottomCandidate;
        const overflowTop = top < insets.top + 8;
        const overflowBottom = top + tooltipSize.h > wrapperSize.h - insets.bottom - 8;

        if (overflowTop && !overflowBottom) top = bottomCandidate;
        if (overflowBottom && !overflowTop) top = topCandidate;

        // 둘 다 넘치면 중앙에 가깝게
        top = clamp(top, insets.top + 8, wrapperSize.h - insets.bottom - tooltipSize.h - 8);

        return { left, top };
    }, [anchor, tooltipSize, wrapperSize, highlightRect, currentStep, insets]);

    const handleNext = () => {
        if (isLastStep) {
            closeRequestedRef.current = true;
            onClose();
            return;
        }
        // rn-tourguide 느낌: 툴팁을 짧게 out → step 변경 → in
        setTooltipPhase('out');
        setTimeout(() => {
            setCurrentStepIndex((prev) => prev + 1);
            setTooltipPhase('in');
            setPulseKey((k) => k + 1);
        }, 140);
    };

    const handlePrev = () => {
        if (currentStepIndex <= 0) return;
        setTooltipPhase('out');
        setTimeout(() => {
            setCurrentStepIndex((prev) => prev - 1);
            setTooltipPhase('in');
            setPulseKey((k) => k + 1);
        }, 140);
    };

    const onTooltipLayout = (e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        // 최초 1~2회만 갱신되어도 충분
        if (Math.abs(width - tooltipSize.w) > 2 || Math.abs(height - tooltipSize.h) > 2) {
            setTooltipSize({ w: width, h: height });
        }
    };

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.container}>
                {/* 전체 페이드 인 */}
                <MotiView
                    from={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ type: 'timing', duration: 180 }}
                    style={StyleSheet.absoluteFillObject}
                />

                <View style={[styles.contentContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                    <View style={styles.header}>
                        <Pressable onPress={onClose} style={styles.closeButton}>
                            <Feather name="x" size={24} color="#fff" />
                        </Pressable>
                    </View>

                    <View style={styles.imageWrapper} onLayout={onWrapperLayout}>
                        <Image source={imageSource} style={styles.image} resizeMode="contain" />

                        {/* ===== Spotlight Dim (구멍) ===== */}
                        {highlightRect && (
                            <>
                                {/* top */}
                                <MotiView
                                    animate={{ left: 0, top: 0, width: wrapperSize.w, height: Math.max(0, highlightRect.y) }}
                                    transition={ORANGE_PREMIUM.move}
                                    style={[styles.dimLayer, { backgroundColor: `rgba(0,0,0,${ORANGE_PREMIUM.dim})` }]}
                                    pointerEvents="none"
                                />
                                {/* left */}
                                <MotiView
                                    animate={{ left: 0, top: highlightRect.y, width: Math.max(0, highlightRect.x), height: highlightRect.h }}
                                    transition={ORANGE_PREMIUM.move}
                                    style={[styles.dimLayer, { backgroundColor: `rgba(0,0,0,${ORANGE_PREMIUM.dim})` }]}
                                    pointerEvents="none"
                                />
                                {/* right */}
                                <MotiView
                                    animate={{
                                        left: highlightRect.x + highlightRect.w,
                                        top: highlightRect.y,
                                        width: Math.max(0, wrapperSize.w - (highlightRect.x + highlightRect.w)),
                                        height: highlightRect.h,
                                    }}
                                    transition={ORANGE_PREMIUM.move}
                                    style={[styles.dimLayer, { backgroundColor: `rgba(0,0,0,${ORANGE_PREMIUM.dim})` }]}
                                    pointerEvents="none"
                                />
                                {/* bottom */}
                                <MotiView
                                    animate={{
                                        left: 0,
                                        top: highlightRect.y + highlightRect.h,
                                        width: wrapperSize.w,
                                        height: Math.max(0, wrapperSize.h - (highlightRect.y + highlightRect.h)),
                                    }}
                                    transition={ORANGE_PREMIUM.move}
                                    style={[styles.dimLayer, { backgroundColor: `rgba(0,0,0,${ORANGE_PREMIUM.dim})` }]}
                                    pointerEvents="none"
                                />
                            </>
                        )}

                        {/* ===== Highlight Box (모핑/이동) ===== */}
                        {highlightRect && (
                            <MotiView
                                from={{ opacity: 0, scale: 0.98 }}
                                animate={{
                                    opacity: 1,
                                    scale: 1,
                                    left: highlightRect.x,
                                    top: highlightRect.y,
                                    width: highlightRect.w,
                                    height: highlightRect.h,
                                }}
                                transition={ORANGE_PREMIUM.move}
                                style={styles.highlightBox}
                                pointerEvents="none"
                            >
                                {/* 은은한 글로우 펄스 */}
                                <MotiView
                                    from={{ opacity: 0.26 }}
                                    animate={{ opacity: 0.08 }}
                                    transition={{ type: 'timing', duration: ORANGE_PREMIUM.pulseDuration, loop: true }}
                                    style={StyleSheet.absoluteFillObject}
                                    pointerEvents="none"
                                />
                                {/* 이동/등장 시 1회성 스냅 줌 */}
                                <MotiView
                                    key={`pulse-${pulseKey}`}
                                    from={{ scale: 0.985, opacity: 0.0 }}
                                    animate={{ scale: 1.0, opacity: 1.0 }}
                                    transition={{ type: 'timing', duration: 140 }}
                                    style={StyleSheet.absoluteFillObject}
                                    pointerEvents="none"
                                />
                            </MotiView>
                        )}

                        {/* ===== Tooltip (부드러운 전환) ===== */}
                        {currentStep && (
                            <MotiView
                                onLayout={onTooltipLayout}
                                animate={
                                    tooltipPhase === 'in'
                                        ? { opacity: 1, translateY: 0, scale: 1 }
                                        : { opacity: 0, translateY: 8, scale: 0.985 }
                                }
                                transition={ORANGE_PREMIUM.tooltip}
                                style={[styles.tooltip, { left: tooltipPos.left, top: tooltipPos.top }]}
                            >
                                <Text style={styles.tooltipTitle}>{currentStep.title}</Text>
                                <Text style={styles.tooltipDesc}>{currentStep.description}</Text>

                                <View style={styles.footer}>
                                    <Text style={styles.pagination}>
                                        {currentStepIndex + 1} / {steps.length}
                                    </Text>

                                    <View style={styles.actions}>
                                        {currentStepIndex > 0 && (
                                            <Pressable onPress={handlePrev} style={styles.actionBtn}>
                                                <Feather name="chevron-left" size={20} color="#4B5563" />
                                                <Text style={styles.actionBtnText}>이전</Text>
                                            </Pressable>
                                        )}

                                        <Pressable onPress={handleNext} style={[styles.actionBtn, styles.primaryBtn]}>
                                            <Text style={styles.primaryBtnText}>{isLastStep ? '완료' : '다음'}</Text>
                                            {!isLastStep && <Feather name="chevron-right" size={16} color="#fff" />}
                                        </Pressable>
                                    </View>
                                </View>
                            </MotiView>
                        )}
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    contentContainer: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        alignItems: 'flex-end',
        zIndex: 30,
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    imageWrapper: {
        flex: 1,
        position: 'relative',
        justifyContent: 'center',
    },
    image: {
        width: '100%',
        height: '100%',
    },

    dimLayer: {
        position: 'absolute',
        zIndex: 10,
    },

    highlightBox: {
        position: 'absolute',
        zIndex: 20,
        borderWidth: 2,
        borderColor: '#fcd34d',
        borderRadius: 16, // 14 → 16 (프리미엄은 라운드 조금 더)
        backgroundColor: 'transparent',
        // shadowColor: '#fcd34d',
        // shadowOpacity: 0.28,
        // shadowRadius: 16,
        // shadowOffset: { width: 0, height: 10 },
        // elevation: 7,
    },

    tooltip: {
        position: 'absolute',
        zIndex: 25,
        backgroundColor: ORANGE_PREMIUM.tooltipBg,
        padding: ORANGE_PREMIUM.tooltipPadding,
        borderRadius: ORANGE_PREMIUM.tooltipRadius,
        width: ORANGE_PREMIUM.tooltipWidth,
        shadowColor: '#000',
        shadowOpacity: ORANGE_PREMIUM.tooltipShadowOpacity,
        shadowRadius: ORANGE_PREMIUM.tooltipShadowRadius,
        shadowOffset: { width: 0, height: 10 },
        elevation: ORANGE_PREMIUM.tooltipElevation,
    },
    tooltipTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 8,
    },
    tooltipDesc: {
        fontSize: 15,
        color: '#4B5563',
        lineHeight: 23,
        marginBottom: 18,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pagination: {
        fontSize: 14,
        color: '#9CA3AF',
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    actions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 16,
        gap: 6,
    },
    actionBtnText: {
        color: '#4B5563',
        fontSize: 15,
        fontWeight: '700',
    },
    primaryBtn: {
        backgroundColor: '#F36F21',
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
});

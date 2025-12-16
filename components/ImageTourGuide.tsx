import { Feather } from '@expo/vector-icons';
import { MotiView } from 'moti';
import React, { useState } from 'react';
import {
    Dimensions,
    Image,
    ImageSourcePropType,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TourStep {
    x: number; // 0-100 percentage
    y: number; // 0-100 percentage
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

const { width, height } = Dimensions.get('window');

export const ImageTourGuide = ({
    visible,
    onClose,
    imageSource,
    steps,
}: ImageTourGuideProps) => {
    const insets = useSafeAreaInsets();
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    const currentStep = steps[currentStepIndex];
    const isLastStep = currentStepIndex === steps.length - 1;

    const handleNext = () => {
        if (isLastStep) {
            onClose();
            setCurrentStepIndex(0);
        } else {
            setCurrentStepIndex((prev) => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentStepIndex > 0) {
            setCurrentStepIndex((prev) => prev - 1);
        }
    };

    // Dynamic Layout Calculation for Tooltip
    // Calculate horizontal position to ensure tooltip stays on screen
    const markerX = width * (currentStep ? currentStep.x / 100 : 0.5);
    const tooltipWidth = 280;
    const screenPadding = 20;

    // Ideal left position (centered on marker)
    const idealLeft = markerX - tooltipWidth / 2;

    // Clamp within screen bounds
    // Min: screenPadding
    // Max: width - tooltipWidth - screenPadding
    const clampedLeft = Math.max(
        screenPadding,
        Math.min(width - tooltipWidth - screenPadding, idealLeft)
    );

    // Convert absolute screen left to relative left from grid point
    // The markerContainer is at markerX. relativeLeft = clampedLeft - markerX
    const relativeLeft = clampedLeft - markerX;

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.container}>
                {/* Background Dimming */}
                <View style={styles.backdrop} />

                {/* Content Container */}
                <View style={[styles.contentContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

                    {/* Header Actions */}
                    <View style={styles.header}>
                        <Pressable onPress={onClose} style={styles.closeButton}>
                            <Feather name="x" size={24} color="#fff" />
                        </Pressable>
                    </View>

                    {/* Screenshot Image Container */}
                    <View style={styles.imageWrapper}>
                        <Image
                            source={imageSource}
                            style={styles.image}
                            resizeMode="contain"
                        />

                        {/* Overlay Markers */}
                        {currentStep && (
                            <View
                                style={[
                                    styles.markerContainer,
                                    {
                                        left: `${currentStep.x}%`,
                                        top: `${currentStep.y}%`,
                                    },
                                ]}
                            >
                                {/* Pulsing Effect */}
                                <MotiView
                                    from={{ opacity: 0.5, scale: 1 }}
                                    animate={{ opacity: 0, scale: 2 }}
                                    transition={{
                                        type: 'timing',
                                        duration: 1500,
                                        loop: true,
                                        repeatReverse: false,
                                    }}
                                    style={styles.pulseRing}
                                />
                                <View style={styles.dot} />

                                {/* Tooltip relative to marker */}
                                {/* Tooltip relative to marker */}
                                <MotiView
                                    from={{ opacity: 0, translateY: 10 }}
                                    animate={{ opacity: 1, translateY: 0 }}
                                    transition={{ type: 'spring' }}
                                    style={[
                                        styles.tooltip,
                                        { left: relativeLeft },
                                        currentStep.tooltipPosition === 'top'
                                            ? { bottom: 30, top: 'auto' } // Show above
                                            : { top: 20, bottom: 'auto' } // Show below (default)
                                    ]}
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
                                                <Text style={styles.primaryBtnText}>
                                                    {isLastStep ? '완료' : '다음'}
                                                </Text>
                                                {!isLastStep && <Feather name="chevron-right" size={16} color="#fff" />}
                                            </Pressable>
                                        </View>
                                    </View>
                                </MotiView>
                            </View>
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
        backgroundColor: 'rgba(0,0,0,0.85)',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    contentContainer: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        alignItems: 'flex-end',
        zIndex: 10,
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
    markerContainer: {
        position: 'absolute',
        alignItems: 'center',
        width: 0,
        height: 0,
        // The coordinate points to the center of interest.
        // We want the dot to be centered there.
    },
    dot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#F36F21', // Hanwha Orange
        borderWidth: 2,
        borderColor: '#fff',
        marginTop: -8, // center visually
        marginLeft: -8,
    },
    pulseRing: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(243, 111, 33, 0.6)',
        top: -20,
        left: -20,
    },
    tooltip: {
        position: 'absolute',
        // top: 20, // Moved to dynamic style
        backgroundColor: '#fff',
        padding: 20, // Increased padding
        borderRadius: 16,
        width: 300, // Slightly wider
        // marginLeft: -140, // REMOVED: Managed dynamically using 'left' prop
        // Basic boundary handling logic could be added here or in render
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16, // Stronger shadow
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB', // Subtle border
    },
    tooltipTitle: {
        fontSize: 18, // 16 -> 18
        fontWeight: '800',
        color: '#111827',
        marginBottom: 6,
    },
    tooltipDesc: {
        fontSize: 15, // 14 -> 15
        color: '#4B5563', // Slightly darker text for contrast
        lineHeight: 22,
        marginBottom: 20,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pagination: {
        fontSize: 13,
        color: '#9CA3AF',
        fontWeight: '600',
    },
    actions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 36, // Taller button
        borderRadius: 18,
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 12, // Added horizontal padding
        gap: 4,
    },
    actionBtnText: {
        color: '#4B5563',
        fontSize: 14,
        fontWeight: '600',
    },
    primaryBtn: {
        backgroundColor: '#F36F21',
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
});

import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const GRAY_BG = '#F3F4F6';
const GRAY_TEXT = '#9CA3AF';

interface MobileStatusToggleProps {
    value: 'pending' | 'approved';
    onChange: (val: 'pending' | 'approved') => void;
    labelPending?: string;
    labelApproved?: string;
    readOnly?: boolean;
}

export function MobileStatusToggle({
    value,
    onChange,
    labelPending = '미승인',
    labelApproved = '승인',
    readOnly = false,
}: MobileStatusToggleProps) {
    // Animation for the indicator
    const anim = useRef(new Animated.Value(value === 'approved' ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(anim, {
            toValue: value === 'approved' ? 1 : 0,
            duration: 200,
            useNativeDriver: false, // Layout animation needs false usually or true if using transform
        }).start();
    }, [value]);

    const handlePress = (target: 'pending' | 'approved') => {
        if (readOnly) return;
        if (value !== target) {
            onChange(target);
        }
    };

    // Interpolate for sliding effect if we used absolute positioning,
    // but for simplicity and robustness in flex layouts, we can just style the active one.
    // Actually, a sliding pill looks premium. Let's try simple active state first to match "Image-like" request.
    // The user image showed a segmented control: [ Text | Text ] with a highlight.

    return (
        <View style={[styles.container, readOnly && styles.readOnly]}>
            <Pressable
                style={[styles.segment, value === 'pending' && styles.activePillBad]} // Bad -> Gray/Red? Pending is neutral/not done.
                onPress={() => handlePress('pending')}
                disabled={readOnly}
            >
                <Text
                    style={[
                        styles.text,
                        value === 'pending' && styles.textActiveBad,
                    ]}
                >
                    {labelPending}
                </Text>
            </Pressable>
            <Pressable
                style={[styles.segment, value === 'approved' && styles.activePillGood]}
                onPress={() => handlePress('approved')}
                disabled={readOnly}
            >
                <Text
                    style={[
                        styles.text,
                        value === 'approved' && styles.textActiveGood,
                    ]}
                >
                    {labelApproved}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: '#E5E7EB', // Darker gray for track
        borderRadius: 20,
        padding: 2,
        height: 32,
        alignItems: 'center',
        width: 140, // Fixed width for consistency
    },
    readOnly: {
        opacity: 0.6,
    },
    segment: {
        flex: 1,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
    },
    activePillGood: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 2,
    },
    activePillBad: {
        backgroundColor: '#fff', // White pill for active Pending too? Or distinct?
        // Usually SegmentedControl moves the white pill.
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 2,
    },
    text: {
        fontSize: 12,
        fontWeight: '600',
        color: GRAY_TEXT,
    },
    textActiveGood: {
        color: '#16a34a', // Green
    },
    textActiveBad: {
        color: CHARCOAL, // or Red/Orange?
    },
});

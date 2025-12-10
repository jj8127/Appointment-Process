import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Pressable,
    StyleSheet,
    View
} from 'react-native';

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const GRAY_TEXT = '#9CA3AF';
const GREEN = '#16a34a';

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
    const anim = useRef(new Animated.Value(value === 'approved' ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(anim, {
            toValue: value === 'approved' ? 1 : 0,
            duration: 250,
            useNativeDriver: true,
        }).start();
    }, [value]);

    const handlePress = (target: 'pending' | 'approved') => {
        if (readOnly) return;
        if (value !== target) {
            onChange(target);
        }
    };

    const translateX = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [2, 70], // 0+2 padding, 140/2 + 2 padding = 72? No, width is 140. inner width 136. half 68. 2 -> 2+68=70.
    });

    const textColorPending = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [CHARCOAL, GRAY_TEXT],
    });

    const textColorApproved = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [GRAY_TEXT, GREEN],
    });

    return (
        <View style={[styles.container, readOnly && styles.readOnly]}>
            <Animated.View
                style={[
                    styles.activePill,
                    {
                        transform: [{ translateX }],
                    },
                ]}
            />
            <Pressable
                style={styles.segment}
                onPress={() => handlePress('pending')}
                disabled={readOnly}
            >
                <Animated.Text style={[styles.text, { color: textColorPending }]}>
                    {labelPending}
                </Animated.Text>
            </Pressable>
            <Pressable
                style={styles.segment}
                onPress={() => handlePress('approved')}
                disabled={readOnly}
            >
                <Animated.Text style={[styles.text, { color: textColorApproved }]}>
                    {labelApproved}
                </Animated.Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: '#E5E7EB',
        borderRadius: 20,
        height: 36,
        width: 140,
        position: 'relative',
        justifyContent: 'center',
    },
    readOnly: {
        opacity: 0.6,
    },
    activePill: {
        position: 'absolute',
        left: 0,
        top: 2,
        bottom: 2,
        width: 68,
        backgroundColor: '#fff',
        borderRadius: 18,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 2,
    },
    segment: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    text: {
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
});

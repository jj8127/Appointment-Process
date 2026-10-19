import { Feather } from '@expo/vector-icons';
import { getHeaderTitle } from '@react-navigation/elements';
import { useRouter, type Href } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { goBackOrReplace } from '@/lib/back-navigation';

/** Back button for screens also opened from notifications, where there may be no previous screen. */
export function FallbackBackButton({ href }: { href: Href }) {
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={() => goBackOrReplace(router, href)} style={styles.backButton}>
            <Feather aria-hidden accessible={false} name="arrow-left" size={24} color="#000" />
        </Pressable>
    );
}

export default function CompactHeader({ navigation, route, options, back }: any) {
    const title = getHeaderTitle(options, route.name);
    const insets = useSafeAreaInsets();
    const leftElement = options.headerLeft
        ? options.headerLeft({ canGoBack: !!back })
        : back ? (
            <Pressable accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={navigation.goBack} style={styles.backButton}>
                <Feather aria-hidden accessible={false} name="arrow-left" size={24} color="#000" />
            </Pressable>
        ) : null;

    return (
        <View style={[styles.container, { height: 48 + insets.top, paddingTop: insets.top }]}>
            <View style={styles.leftContainer}>
                {leftElement}
            </View>

            <View style={styles.titleContainer}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
            </View>

            <View style={styles.rightContainer}>
                {options.headerRight ? options.headerRight() : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#fff',
        paddingHorizontal: 16,
    },
    // ... existing sub-styles ...
    leftContainer: {
        width: 44,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    rightContainer: {
        minWidth: 44,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -4,
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: '#000',
        textAlign: 'center',
    },
});

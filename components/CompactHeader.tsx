import { Feather } from '@expo/vector-icons';
import { getHeaderTitle } from '@react-navigation/elements';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CompactHeader({ navigation, route, options, back }: any) {
    const title = getHeaderTitle(options, route.name);
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { height: 48 + insets.top, paddingTop: insets.top }]}>
            <View style={styles.leftContainer}>
                {back ? (
                    <Pressable onPress={navigation.goBack} style={styles.backButton}>
                        <Feather name="arrow-left" size={24} color="#000" />
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.titleContainer}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
            </View>

            <View style={styles.rightContainer}>
                {/* Placeholder for future right header actions */}
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
        width: 40,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    rightContainer: {
        width: 40,
    },
    backButton: {
        padding: 4,
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

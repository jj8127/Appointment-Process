import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Keyboard,
    Pressable,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { FormInput } from '@/components/FormInput';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useLogin } from '@/hooks/use-login';
import WebLogo from '../adminWebLogo.png';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

export default function LoginScreen() {
    const { skipAuto } = useLocalSearchParams<{ skipAuto?: string }>();
    const skipAutoRedirect = skipAuto === '1';
    const { role, residentId, hydrated } = useSession();
    const [phoneInput, setPhoneInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const keyboardPadding = useKeyboardPadding();

    // Use custom login hook
    const { login, loading } = useLogin();

    useEffect(() => {
        if (skipAutoRedirect) return;
        if (!hydrated) return;
        if (role === 'admin') {
            router.replace('/');
            return;
        }
        if (role === 'fc' && residentId) {
            router.replace('/home-lite');
        }
    }, [hydrated, residentId, role, skipAutoRedirect]);

    const handleLogin = () => {
        login(phoneInput, passwordInput);
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#ffffff', '#fff1e6']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            />

            <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
                <KeyboardAwareWrapper
                    contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardPadding + 40 }]}
                    extraScrollHeight={140}
                    keyboardShouldPersistTaps="always"
                >
                    <View style={styles.innerContent}>
                        <MotiView
                            from={{ opacity: 0, translateY: -20 }}
                            animate={{ opacity: 1, translateY: 0 }}
                            transition={{ type: 'timing', duration: 800, delay: 100 }}
                            style={styles.logoContainer}
                        >
                            <Image source={WebLogo} style={styles.logo} resizeMode="contain" />
                            <View style={styles.logoDecoration} />
                        </MotiView>

                        <MotiView
                            from={{ opacity: 0, translateY: 30, scale: 0.98 }}
                            animate={{ opacity: 1, translateY: 0, scale: 1 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 100, delay: 300 }}
                            style={styles.card}
                        >
                            <View style={styles.headerSection}>
                                <Text style={styles.title}>로그인</Text>
                            <Text style={styles.subtitle}>
                                관리자는 지정된 번호 + 비밀번호{'\n'}FC는 휴대폰 번호 + 비밀번호로 로그인해주세요.
                            </Text>
                        </View>

                        <FormInput
                            label="휴대폰 번호"
                            placeholder="번호 입력 (- 없이 숫자만)"
                            value={phoneInput}
                            onChangeText={setPhoneInput}
                            autoCapitalize="none"
                            keyboardType="number-pad"
                            returnKeyType="next"
                            onSubmitEditing={handleLogin}
                            editable={!loading}
                            containerStyle={styles.inputContainer}
                        />

                        <FormInput
                            label="비밀번호"
                            variant="password"
                            placeholder="8자 이상, 영문+숫자+특수문자"
                            value={passwordInput}
                            onChangeText={setPasswordInput}
                            autoCapitalize="none"
                            returnKeyType="done"
                            onSubmitEditing={handleLogin}
                            editable={!loading}
                            containerStyle={styles.inputContainer}
                        />


                            <Pressable
                                style={({ pressed }) => [
                                    styles.button,
                                    pressed && styles.buttonPressed,
                                    loading && styles.buttonDisabled,
                                ]}
                                onPressIn={() => Keyboard.dismiss()}
                                onPress={handleLogin}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.buttonText}>로그인</Text>
                                )}
                            </Pressable>

                            <Pressable
                                style={({ pressed }) => [styles.linkButton, pressed && styles.backButtonPressed]}
                                onPress={() => router.push('/reset-password')}
                            >
                                <Text style={styles.linkButtonText}>비밀번호를 잊으셨나요?</Text>
                            </Pressable>

                            <Pressable
                                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                                onPress={() => router.replace('/signup')}
                            >
                                <Text style={styles.backButtonText}>회원가입</Text>
                            </Pressable>
                        </MotiView>
                    </View>
                </KeyboardAwareWrapper>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safe: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingTop: 0,
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING['2xl'],
    },
    innerContent: {
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 0,
        marginTop: 2,
        position: 'relative',
    },
    logo: {
        width: 220,
        height: 240,
    },
    logoDecoration: {
        position: 'absolute',
        bottom: SPACING.lg,
        width: SPACING['2xl'],
        height: SPACING.xs,
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.sm,
        opacity: 0.2,
    },
    card: {
        backgroundColor: COLORS.white,
        borderRadius: RADIUS.xl,
        padding: SPACING['2xl'],
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 8,
        borderWidth: 1,
        borderColor: COLORS.primaryPale,
    },
    headerSection: {
        marginBottom: SPACING['2xl'],
        alignItems: 'center',
    },
    title: {
        fontSize: TYPOGRAPHY.fontSize['3xl'],
        fontWeight: TYPOGRAPHY.fontWeight.extrabold,
        color: COLORS.text.primary,
        marginBottom: SPACING.sm,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: TYPOGRAPHY.fontSize.base,
        color: COLORS.text.secondary,
        textAlign: 'center',
        lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.base,
    },
    inputContainer: {
        marginBottom: SPACING.base,
    },
    button: {
        height: 56,
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonPressed: {
        backgroundColor: COLORS.primaryDark,
        transform: [{ scale: 0.98 }],
    },
    buttonDisabled: {
        backgroundColor: COLORS.primaryLight,
        shadowOpacity: 0,
    },
    buttonText: {
        fontSize: TYPOGRAPHY.fontSize.lg,
        fontWeight: TYPOGRAPHY.fontWeight.bold,
        color: COLORS.white,
    },
    backButton: {
        marginTop: SPACING.base,
        alignItems: 'center',
        paddingVertical: SPACING.md,
    },
    backButtonPressed: {
        opacity: 0.7,
    },
    backButtonText: {
        fontSize: TYPOGRAPHY.fontSize.sm,
        color: COLORS.text.secondary,
        fontWeight: TYPOGRAPHY.fontWeight.semibold,
        textDecorationLine: 'underline',
    },
    linkButton: {
        marginTop: SPACING.md,
        alignItems: 'center',
        paddingVertical: SPACING.sm,
    },
    linkButtonText: {
        fontSize: TYPOGRAPHY.fontSize.sm,
        color: COLORS.text.secondary,
        fontWeight: TYPOGRAPHY.fontWeight.semibold,
        textDecorationLine: 'underline',
    },
});

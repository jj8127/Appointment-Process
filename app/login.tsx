import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Image,
    Pressable,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { FormInput } from '@/components/FormInput';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { useSession } from '@/hooks/use-session';
import { useLogin } from '@/hooks/use-login';
import { logger } from '@/lib/logger';
import {
    clearSavedLoginCredentials,
    getSavedLoginCredentials,
    setSavedLoginCredentials,
} from '@/lib/saved-login-credentials';
import { resolveSessionLandingRoute } from '@/lib/session-landing';
import WebLogo from '../assets/images/login.png';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';

const AUTH_SCREEN_BACKGROUND = COLORS.primaryPale;

export default function LoginScreen() {
    const { skipAuto } = useLocalSearchParams<{ skipAuto?: string }>();
    const skipAutoRedirect = skipAuto === '1';
    const { role, residentId, hydrated, isRequestBoardDesigner } = useSession();
    const [phoneInput, setPhoneInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [rememberPassword, setRememberPassword] = useState(false);
    const keyboardPadding = useKeyboardPadding();
    const rememberPasswordPressInHandledRef = useRef(false);

    // Use custom login hook
    const { login, loading } = useLogin();

    useEffect(() => {
        let active = true;

        getSavedLoginCredentials()
            .then((saved) => {
                if (!active || !saved) return;
                setPhoneInput(saved.phone);
                setPasswordInput(saved.password);
                setRememberPassword(true);
            })
            .catch((error) => {
                logger.warn('[login] failed to restore saved credentials', error);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (skipAutoRedirect) return;
        if (!hydrated) return;
        const nextRoute = resolveSessionLandingRoute({
            role,
            residentId,
            isRequestBoardDesigner,
        });
        if (nextRoute) {
            router.replace(nextRoute);
        }
    }, [hydrated, isRequestBoardDesigner, residentId, role, skipAutoRedirect]);

    const toggleRememberPassword = useCallback(() => {
        setRememberPassword((current) => {
            const next = !current;
            if (!next) {
                clearSavedLoginCredentials().catch((error) => {
                    logger.warn('[login] failed to clear saved credentials', error);
                });
            }
            return next;
        });
    }, []);

    const handleRememberPasswordPressIn = useCallback(() => {
        rememberPasswordPressInHandledRef.current = true;
        toggleRememberPassword();
    }, [toggleRememberPassword]);

    const handleRememberPasswordPress = useCallback(() => {
        if (rememberPasswordPressInHandledRef.current) {
            rememberPasswordPressInHandledRef.current = false;
            return;
        }
        toggleRememberPassword();
    }, [toggleRememberPassword]);

    const handleLogin = async () => {
        const success = await login(phoneInput, passwordInput);
        if (!success) return;

        try {
            await setSavedLoginCredentials({
                rememberPassword: rememberPassword ? true : false,
                phone: phoneInput,
                password: passwordInput,
            });
        } catch (error) {
            logger.warn('[login] failed to persist saved credentials preference', error);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.authBackground} pointerEvents="none" />

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
                                style={({ pressed }) => [styles.rememberRow, pressed && styles.rememberRowPressed]}
                                onPressIn={handleRememberPasswordPressIn}
                                onPress={handleRememberPasswordPress}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: rememberPassword }}
                                accessibilityLabel="비밀번호 저장"
                                disabled={loading}
                            >
                                <View style={[styles.checkbox, rememberPassword && styles.checkboxChecked]}>
                                    {rememberPassword ? <Feather name="check" size={14} color={COLORS.white} /> : null}
                                </View>
                                <Text style={styles.rememberText}>비밀번호 저장</Text>
                            </Pressable>

                            <Button
                                style={[styles.button, loading && styles.buttonDisabled]}
                                textStyle={styles.buttonText}
                                onPress={handleLogin}
                                disabled={loading}
                                loading={loading}
                                submitOnPressIn
                                dismissKeyboardOnPress
                            >
                                {loading ? '' : '로그인'}
                            </Button>

                            <Pressable
                                style={({ pressed }) => [styles.linkButton, pressed && styles.backButtonPressed]}
                                onPress={() => router.push('/reset-password')}
                            >
                                <Text style={styles.linkButtonText}>비밀번호 변경하기</Text>
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
        backgroundColor: AUTH_SCREEN_BACKGROUND,
    },
    authBackground: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: AUTH_SCREEN_BACKGROUND,
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
        height: 210,
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
    rememberRow: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: SPACING.sm,
        marginTop: -SPACING.xs,
        marginBottom: SPACING.lg,
        paddingVertical: SPACING.xs,
        paddingRight: SPACING.sm,
    },
    rememberRowPressed: {
        opacity: 0.7,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: RADIUS.sm,
        borderWidth: 1.5,
        borderColor: COLORS.border.medium,
        backgroundColor: COLORS.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primary,
    },
    rememberText: {
        fontSize: TYPOGRAPHY.fontSize.sm,
        fontWeight: TYPOGRAPHY.fontWeight.semibold,
        color: COLORS.text.secondary,
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

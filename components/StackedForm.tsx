import { Feather } from '@expo/vector-icons';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

import { Button } from '@/components/Button';
import { KeyboardSafeBottomBar } from '@/components/KeyboardSafeBottomBar';
import { SIGNUP_MOTION } from '@/lib/signup-steps';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';

/**
 * One-question-at-a-time form pieces shared by the signup screens.
 * Newest question on top, answered ones pushed down, pickers in a bottom sheet
 * whose content cross-fades to the next question (2026-10-16 Shinhan SOL Life reference).
 */

const MOTION_EASING = Easing.out(Easing.cubic);
const ITEM_ENTER = FadeInDown.duration(SIGNUP_MOTION.insert).easing(MOTION_EASING);
const ITEM_LAYOUT = LinearTransition.duration(SIGNUP_MOTION.insert).easing(MOTION_EASING);
const LABEL_ENTER = FadeIn.delay(SIGNUP_MOTION.labelDelay).duration(SIGNUP_MOTION.label);
const SHEET_LAYOUT = LinearTransition.duration(SIGNUP_MOTION.sheetSwap).easing(MOTION_EASING);

/** A question in the stack; slides in from above and moves down as newer questions arrive. */
export function StackItem({ children }: PropsWithChildren) {
  return <Animated.View entering={ITEM_ENTER} layout={ITEM_LAYOUT}>{children}</Animated.View>;
}

export function StackLabel({ children }: { children: string }) {
  return <Animated.Text entering={LABEL_ENTER} style={styles.label}>{children}</Animated.Text>;
}

export function StackField({ label, active, children, message, error }: {
  label: string;
  active: boolean;
  children: ReactNode;
  /** Status under the line, e.g. a sent-code notice. */
  message?: string | null;
  error?: string | null;
}) {
  return (
    <View style={styles.field}>
      <StackLabel>{label}</StackLabel>
      <View style={[styles.line, active && styles.lineActive]}>{children}</View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function StackSelectValue({ value, placeholder, onPress, accessibilityLabel }: {
  value: string;
  placeholder: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.selectValue}>
      <Text style={[styles.value, styles.flex, !value && styles.placeholder]} numberOfLines={2}>
        {value || placeholder}
      </Text>
      <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
    </Pressable>
  );
}

export function StackSheetOption({ label, selected, onPress, multiple = false }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  multiple?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={multiple ? { checked: selected } : { selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
      {selected ? (
        <View style={styles.optionMark}>
          <Feather name="check" size={14} color={COLORS.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** 다음 button riding on the keyboard, shown once the current answer is not empty. */
export function StackDockedNext({ label = '다음', disabled = false, onPress }: { label?: string; disabled?: boolean; onPress: () => void }) {
  return (
    <KeyboardSafeBottomBar>
      <Animated.View entering={FadeIn.duration(SIGNUP_MOTION.nextBar)} style={styles.docked}>
        {/* Pressed while the keyboard is open: fire on press-in so the first tap is not spent closing it. */}
        <StackButton label={label} disabled={disabled} onPress={onPress} submitOnPressIn />
      </Animated.View>
    </KeyboardSafeBottomBar>
  );
}

/** Rounded bottom button for the final step when the keyboard is down. */
export function StackSubmit({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  // Screens leave the bottom edge to these buttons so nothing pads the gap above the keyboard.
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn.duration(SIGNUP_MOTION.insert)} style={[styles.submitWrap, { paddingBottom: SPACING.base + insets.bottom }]}>
      <StackButton label={label} disabled={disabled} onPress={onPress} />
    </Animated.View>
  );
}

export function StackButton({ label, disabled = false, onPress, submitOnPressIn = false }: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  submitOnPressIn?: boolean;
}) {
  return (
    <Button onPress={onPress} disabled={disabled} submitOnPressIn={submitOnPressIn} size="lg" fullWidth style={styles.button}>
      {label}
    </Button>
  );
}

/**
 * Dimmed bottom sheet. Changing `contentKey` while open cross-fades the content and
 * resizes the sheet instead of closing and reopening it.
 */
export function StackSheet({ contentKey, title, onClose, children, footer }: {
  contentKey: string | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // The sheet sits on the screen edge, so it adds the navigation bar height itself.
  const insets = useSafeAreaInsets();
  if (!contentKey) return null;
  return (
    <>
      <Animated.View entering={FadeIn.duration(SIGNUP_MOTION.sheet)} exiting={FadeOut.duration(SIGNUP_MOTION.sheet)} style={styles.dim}>
        <Pressable accessibilityLabel="선택 닫기" style={styles.flex} onPress={onClose} />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(SIGNUP_MOTION.sheet).easing(MOTION_EASING)}
        exiting={SlideOutDown.duration(SIGNUP_MOTION.sheet)}
        layout={SHEET_LAYOUT}
        style={[styles.sheet, { paddingBottom: SPACING.xl + insets.bottom }]}
      >
        <Animated.View key={contentKey} entering={FadeIn.duration(SIGNUP_MOTION.sheetSwap)} exiting={FadeOut.duration(SIGNUP_MOTION.sheetSwap / 2)}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" hitSlop={12} onPress={onClose}>
              <Feather name="x" size={22} color={COLORS.text.primary} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer}
        </Animated.View>
      </Animated.View>
    </>
  );
}

export const stackFormStyles = StyleSheet.create({
  title: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
  },
  content: { paddingHorizontal: SPACING.lg, gap: 28 },
  input: {
    paddingVertical: 8,
    paddingHorizontal: 0,
    fontSize: TYPOGRAPHY.fontSize.lg,
    color: COLORS.text.primary,
    minHeight: 44,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: 6 },
  label: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.secondary },
  line: { borderBottomWidth: 1, borderBottomColor: COLORS.border.light, minHeight: 44, justifyContent: 'center' },
  lineActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  value: { fontSize: TYPOGRAPHY.fontSize.lg, color: COLORS.text.primary },
  placeholder: { color: COLORS.text.muted },
  message: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.text.secondary, lineHeight: 20 },
  error: { fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.error, lineHeight: 20 },
  selectValue: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 44, paddingVertical: 8 },
  docked: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.sm, backgroundColor: COLORS.white },
  submitWrap: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  button: { minHeight: 54, borderRadius: 14 },
  dim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: COLORS.white,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: SPACING.base },
  sheetTitle: { flex: 1, fontSize: TYPOGRAPHY.fontSize.lg, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary },
  sheetList: { flexGrow: 0 },
  sheetListContent: { gap: SPACING.sm, paddingBottom: SPACING.base },
  option: {
    minHeight: 48,
    borderRadius: RADIUS.base,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.base,
  },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  optionText: { fontSize: TYPOGRAPHY.fontSize.md, color: COLORS.text.primary },
  optionTextSelected: { color: COLORS.primaryDark, fontWeight: TYPOGRAPHY.fontWeight.bold },
  optionMark: {
    position: 'absolute',
    right: SPACING.base,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
});

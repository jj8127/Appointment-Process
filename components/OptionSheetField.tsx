import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SystemBarsModal } from '@/components/SystemBarsModal';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/lib/theme';

type OptionSheetFieldProps<T extends string> = {
  label: string;
  value: T | '';
  /** Plain strings are their own label; `{ value, label }` shows a different label (codes, ids). */
  options: readonly (T | { value: T; label: string })[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Hide the visible label when the field sits inside a labelled row. */
  hideLabel?: boolean;
};

/**
 * Select field that opens a bottom sheet list, matching FormInput geometry.
 * Replaces long chip walls for fixed choice lists (carrier, affiliation).
 */
export function OptionSheetField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = '선택해 주세요',
  disabled = false,
  error,
  hideLabel = false,
}: OptionSheetFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const items = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const shown = items.find((item) => item.value === value)?.label ?? '';

  return (
    <View style={styles.container}>
      {!hideLabel && <Text style={styles.label}>{label}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} 선택, ${shown || '선택 안 함'}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, open && styles.fieldOpen, !!error && styles.fieldError, pressed && styles.pressed, disabled && styles.disabled]}
      >
        <Text numberOfLines={1} style={[styles.value, !shown && styles.placeholder]}>{shown || placeholder}</Text>
        <Feather accessible={false} name="chevron-down" size={20} color={COLORS.text.secondary} />
      </Pressable>
      {!!error?.trim() && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

      <SystemBarsModal visible={open} transparent animationType="slide" onRequestClose={close}>
        {(insets) => <Pressable accessibilityLabel={`${label} 선택 닫기`} style={styles.backdrop} onPress={close}>
          <View
            accessibilityViewIsModal
            onStartShouldSetResponder={() => true}
            style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.base }]}
          >
            <View style={styles.handle} />
            <Text accessibilityRole="header" style={styles.sheetTitle}>{label}</Text>
            <ScrollView keyboardShouldPersistTaps="always" disableScrollViewPanResponder style={styles.list} bounces={false}>
              {items.map(option => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => { onChange(option.value); close(); }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Text style={[styles.rowText, selected && styles.rowTextSelected]}>{option.label}</Text>
                    {selected && <Feather accessible={false} name="check" size={20} color={COLORS.primaryButton} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>}
      </SystemBarsModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.sm },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    marginLeft: SPACING.xs,
  },
  field: {
    height: 56,
    borderWidth: 1.5,
    borderRadius: RADIUS.lg,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.background.secondary,
    paddingHorizontal: SPACING.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  fieldOpen: { borderColor: COLORS.primary, backgroundColor: COLORS.white },
  fieldError: { borderColor: COLORS.error },
  error: { fontSize: TYPOGRAPHY.fontSize.xs, color: COLORS.error, marginLeft: SPACING.xs },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  value: { flex: 1, fontSize: TYPOGRAPHY.fontSize.md, color: COLORS.text.primary },
  placeholder: { color: COLORS.text.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gray[200],
    marginBottom: SPACING.base,
  },
  sheetTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.text.primary,
    paddingHorizontal: SPACING.base,
    marginBottom: SPACING.sm,
  },
  list: { flexGrow: 0 },
  row: {
    minHeight: 56,
    paddingHorizontal: SPACING.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS.md,
  },
  rowPressed: { backgroundColor: COLORS.gray[100] },
  rowText: { fontSize: TYPOGRAPHY.fontSize.md, color: COLORS.text.primary },
  rowTextSelected: { color: COLORS.primaryButton, fontWeight: TYPOGRAPHY.fontWeight.bold },
});

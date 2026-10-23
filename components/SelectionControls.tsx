import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '@/lib/theme';

/**
 * Value pickers and action lists that replace stacked full-width buttons.
 * Buttons run actions; choosing a value uses these (Apple HIG, SEED, KRDS):
 * 2–4 short options → SegmentedControl, up to ~7 or long labels → ChoiceRows,
 * longer fixed lists → OptionSheetField, several navigation/actions → ActionRows.
 */

export type IconName = ComponentProps<typeof MaterialIcons>['name'];
export type TileTone = keyof typeof COLORS.tile;
export type Choice<T extends string> = { value: T; label: string; description?: string; color?: string };

/** Filled icon on a tinted square; the tone carries the meaning, so callers pick it by meaning. */
export function IconTile({ name, tone, size = 40 }: { name: IconName; tone: TileTone; size?: number }) {
  return <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: COLORS.tile[tone].bg }]}>
    <MaterialIcons name={name} size={Math.round(size * 0.55)} color={COLORS.tile[tone].fg} accessible={false} />
  </View>;
}

/** One track with 2–4 short, equally weighted options. */
export function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T | ''; options: readonly Choice<T>[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.track, disabled && styles.disabled]}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled}
        onPress={() => onChange(option.value)} style={[styles.segment, selected && styles.segmentOn]}>
        <Text numberOfLines={2} style={[styles.segmentText, selected && styles.segmentTextOn]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** Radio list rows: the whole row is the target and a check marks the choice. */
export function ChoiceRows<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T | ''; options: readonly Choice<T>[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.group, disabled && styles.disabled]}>
    {options.map((option, index) => {
      const selected = option.value === value;
      const tint = option.color ?? COLORS.primaryButton;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}>
        {option.color && <View style={[styles.dot, { backgroundColor: option.color }]} />}
        <View style={styles.copy}>
          <Text style={[styles.rowText, selected && { color: tint, fontWeight: '700' }]}>{option.label}</Text>
          {option.description && <Text style={styles.description}>{option.description}</Text>}
        </View>
        <MaterialIcons name={selected ? 'check-circle' : 'radio-button-unchecked'} size={24} color={selected ? tint : COLORS.gray[300]} accessible={false} />
      </Pressable>;
    })}
  </View>;
}

export type ActionRow = { key?: string; label: string; onPress: () => void; icon?: IconName; tone?: TileTone; detail?: string; disabled?: boolean };

/** Grouped list rows with a chevron, for moving to another screen or loading an item. */
export function ActionRows({ items }: { items: readonly ActionRow[] }) {
  return <View style={styles.group}>
    {items.map((item, index) => <Pressable key={item.key ?? item.label} accessibilityRole="button" accessibilityState={{ disabled: !!item.disabled }} disabled={item.disabled}
      onPress={item.onPress} style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed, item.disabled && styles.disabled]}>
      {item.icon && <IconTile name={item.icon} tone={item.tone ?? 'slate'} size={34} />}
      <View style={styles.copy}>
        <Text style={styles.actionText}>{item.label}</Text>
        {item.detail && <Text style={styles.description}>{item.detail}</Text>}
      </View>
      <MaterialIcons name="chevron-right" size={24} color={COLORS.gray[400]} accessible={false} />
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 14, backgroundColor: COLORS.gray[100] },
  segment: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: COLORS.white, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 2 },
  segmentText: { fontSize: 15, lineHeight: 20, color: COLORS.text.secondary, textAlign: 'center' },
  segmentTextOn: { color: COLORS.text.primary, fontWeight: '700' },
  group: { borderWidth: 1, borderColor: COLORS.border.light, borderRadius: 16, overflow: 'hidden', backgroundColor: COLORS.white },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: COLORS.gray[100] },
  pressed: { backgroundColor: COLORS.gray[50] },
  disabled: { opacity: 0.5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  rowText: { fontSize: 16, lineHeight: 22, color: COLORS.text.primary },
  actionText: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: COLORS.text.primary },
  description: { fontSize: 13, lineHeight: 18, color: COLORS.gray[500] },
});

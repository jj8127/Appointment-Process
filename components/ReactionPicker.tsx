import { Feather } from '@expo/vector-icons';
import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { COLORS, SPACING, TYPOGRAPHY, ANIMATION } from '@/lib/theme';

export interface ReactionType {
  id: string;
  icon: string;
  label: string;
  color: string;
}

export const DEFAULT_REACTIONS: ReactionType[] = [
  { id: 'like', icon: 'thumbs-up', label: '좋아요', color: '#3b82f6' },
  { id: 'heart', icon: 'heart', label: '하트', color: '#ef4444' },
  { id: 'check', icon: 'check-circle', label: '확인', color: '#047857' },
  { id: 'smile', icon: 'smile', label: '웃음', color: COLORS.warning.dark },
];

interface ReactionButtonProps {
  reaction: ReactionType;
  onPress: (id: string) => void;
  selected?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ReactionButton({ reaction, onPress, selected }: ReactionButtonProps) {
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, ANIMATION.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    // Bounce + rotate animation
    scale.value = withSequence(
      withSpring(1.2, { damping: 10, stiffness: 400 }),
      withSpring(1, ANIMATION.spring.bouncy),
    );
    rotation.value = withSequence(
      withTiming(-10, { duration: 80 }),
      withTiming(10, { duration: 80 }),
      withTiming(0, { duration: 80 }),
    );

    onPress(reaction.id);
  }, [onPress, reaction.id, rotation, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  const isSelected = Boolean(selected);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={reaction.label}
      accessibilityState={{ selected: isSelected }}
      aria-pressed={isSelected}
      style={[
        styles.reactionButton,
        { borderColor: reaction.color },
        isSelected && { backgroundColor: `${reaction.color}1A`, borderWidth: 2 },
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Feather aria-hidden accessible={false} name={reaction.icon as keyof typeof Feather.glyphMap} size={18} color={reaction.color} />
    </AnimatedPressable>
  );
}

export interface ReactionPickerProps {
  reactions?: ReactionType[];
  onReact: (reactionId: string) => void;
  selectedReactions?: string[];
  reactionCounts?: Record<string, number>;
  style?: ViewStyle;
  showLabels?: boolean;
  compact?: boolean;
}

function ReactionPickerComponent({
  reactions = DEFAULT_REACTIONS,
  onReact,
  selectedReactions = [],
  reactionCounts = {},
  style,
  showLabels = false,
  compact = false,
}: ReactionPickerProps) {
  return (
    <View style={[styles.buttonsRow, compact && styles.buttonsRowCompact, style]}>
      {reactions.map((reaction) => {
        const isSelected = selectedReactions.includes(reaction.id);
        const count = reactionCounts[reaction.id];
        const showCount = typeof count === 'number';
        return (
        <View key={reaction.id} style={styles.buttonWrapper}>
          <ReactionButton
            reaction={reaction}
            onPress={onReact}
            selected={isSelected}
          />
          {showCount && (
            <Text
              style={[
                styles.countLabel,
                { color: isSelected ? reaction.color : COLORS.text.muted },
              ]}
            >
              {count}
            </Text>
          )}
          {showLabels && (
            <Text style={[styles.label, { color: reaction.color }]}>{reaction.label}</Text>
          )}
        </View>
        );
      })}
    </View>
  );
}

export const ReactionPicker = memo(ReactionPickerComponent);

const styles = StyleSheet.create({
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: SPACING.md,
  },
  buttonsRowCompact: {
    gap: SPACING.sm,
  },
  buttonWrapper: {
    alignItems: 'center',
    gap: SPACING.xs,
  },
  reactionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },
  countLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
});

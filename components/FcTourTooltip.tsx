import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TooltipProps } from 'rn-tourguide';

export default function FcTourTooltip({
  currentStep,
  isLastStep,
  handleNext,
  handleStop,
}: TooltipProps) {
  return (
    <View style={styles.container}>
      {!!currentStep?.text && <Text style={styles.text}>{currentStep.text}</Text>}

      <View style={styles.buttonRow}>
        <Pressable onPress={handleStop} hitSlop={10}>
          <Text style={styles.buttonText}>건너뛰기</Text>
        </Pressable>

        <Pressable
          onPress={isLastStep ? handleStop : handleNext}
          hitSlop={10}
          style={styles.nextBtn}>
          <Text style={styles.buttonText}>{isLastStep ? '완료' : '다음'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    minWidth: 260,
  },
  text: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    marginTop: 8,
  },
  nextBtn: {
    marginLeft: 16, // 간격을 더 벌리고 싶으면 숫자를 키우세요
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#22c55e',
  },
});

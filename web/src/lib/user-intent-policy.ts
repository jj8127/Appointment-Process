/** Enter confirms a composing character; it must not also submit the message. */
export function shouldSubmitOnEnter(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return event.key === 'Enter' && !event.shiftKey
    && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function isValidCareerType(value: unknown): boolean {
  return value === null || value === '' || value === '신입' || value === '경력';
}

export function requireMutationSuccess(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (value as Record<string, unknown>).ok !== true) {
    throw new Error('저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 상태를 확인한 뒤 다시 시도해주세요.');
  }
}

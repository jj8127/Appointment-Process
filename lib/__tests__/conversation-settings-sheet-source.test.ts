import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'components', 'messenger', 'ConversationSettingsSheet.tsx'),
  'utf8',
);

describe('conversation settings sheet source contract', () => {
  it('stays controlled and API-agnostic across all typed messenger rooms', () => {
    expect(source).toContain('room: MessengerNotificationRoomRef');
    expect(source).toContain('onPreferenceChange: (change: MessengerNotificationPreferenceChange) => void');
    expect(source).toContain('onRetryLoad: () => void');
    expect(source).toContain('onRetryPreferenceChange: (change: MessengerNotificationPreferenceChange) => void');
    expect(source).toContain("failure.operation === 'load'");
    expect(source).toContain('failure.attemptedMuted');
    expect(source).not.toContain('roomKey');
    expect(source).not.toContain('supabase');
    expect(source).not.toContain('functions.invoke');
    expect(source).not.toContain('fetch(');
  });

  it('renders only notification controls with accessible 44px actions', () => {
    expect(source).toContain("toggleLabel = muted ? '알림 켜기' : '알림 끄기'");
    expect(source).toContain('accessibilityRole="switch"');
    expect(source).toContain('accessibilityLabel={toggleLabel}');
    expect(source).toContain('accessibilityLabel="대화 설정 닫기"');
    expect(source).toContain("? '알림 설정 다시 불러오기'");
    expect(source).toContain(": '알림 설정 다시 저장'");
    expect(source).toContain('minHeight: TOUCH_TARGET.min');
    expect(source).toContain('width: TOUCH_TARGET.min');
    expect(source).toContain('height: TOUCH_TARGET.min');
    expect(source).not.toContain('나가기');
    expect(source).not.toContain('삭제');
  });

  it('keeps pending, disabled, inline failure, and retry states visible', () => {
    expect(source).toContain('const interactionDisabled = pending || disabled');
    expect(source).toContain("const retryDisabled = pending || (disabled && failure?.operation !== 'load')");
    expect(source).toContain('if (!failure || retryDisabled) return;');
    expect(source).not.toContain('if (!failure || interactionDisabled) return;');
    expect(source).toContain('<ActivityIndicator');
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('accessibilityState={{ disabled: retryDisabled }}');
    expect(source).toContain('disabled={retryDisabled}');
    expect(source).toContain('onRetryLoad();');
    expect(source).toContain('onRetryPreferenceChange(');
    expect(source).toContain("<Text style={styles.retryLabel}>다시 시도</Text>");
    expect(source).toContain('testID="conversation-notification-error"');
    expect(source).toContain('COLORS.primaryPale');
  });
});

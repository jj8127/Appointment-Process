import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NotificationReceiptCompletionState } from './use-notification-receipt';

export function NotificationReceiptStatusBanner(props: {
  state: NotificationReceiptCompletionState;
  onRetry: () => void;
}) {
  if (props.state !== 'mark_failed' && props.state !== 'target_unavailable') {
    return null;
  }

  const canRetry = props.state === 'mark_failed';
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        {canRetry
          ? '페이지는 열렸지만 알림 읽음 처리를 완료하지 못했습니다.'
          : '알림의 정확한 대상과 현재 페이지를 확인할 수 없습니다.'}
      </Text>
      {canRetry ? (
        <Pressable style={styles.button} onPress={props.onRetry}>
          <Text style={styles.buttonText}>다시 시도</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    color: '#991B1B',
    fontSize: 12,
    lineHeight: 18,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#B91C1C',
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

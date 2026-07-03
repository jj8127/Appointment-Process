import { StyleSheet, Text } from 'react-native';

import { formatUnreadReceiptCount } from '@/lib/message-read-receipts';

type MessageUnreadReceiptBadgeProps = {
  count?: number | null;
};

export function MessageUnreadReceiptBadge({ count }: MessageUnreadReceiptBadgeProps) {
  const text = formatUnreadReceiptCount(Number(count ?? 0));
  if (!text) return null;

  return <Text style={styles.messageUnreadCount}>{text}</Text>;
}

const styles = StyleSheet.create({
  messageUnreadCount: {
    fontSize: 11,
    lineHeight: 13,
    color: '#f36f21',
    fontWeight: '800',
  },
});

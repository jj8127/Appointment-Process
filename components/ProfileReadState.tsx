import { ActivityIndicator, Text, View } from 'react-native';
import { QueryReadState } from './QueryReadState';

export function ProfileReadState({ state, retained, onRetry }: {
  state: 'loading' | 'success' | 'error'; retained: boolean; onRetry: () => void;
}) {
  if (state === 'success') return null;
  if (state === 'loading') return <View style={{ padding: 20, gap: 8 }}>
    <ActivityIndicator />
    <Text>{retained ? '기존 정보를 표시하며 최신 상태를 확인하고 있습니다.' : '업무 정보를 확인하고 있습니다.'}</Text>
  </View>;
  return <QueryReadState message={retained
    ? '최신 상태를 확인하지 못했습니다. 마지막으로 확인한 정보를 표시합니다.'
    : '업무 상태를 확인하지 못했습니다. 정보를 다시 불러와 주세요.'} onRetry={onRetry} />;
}

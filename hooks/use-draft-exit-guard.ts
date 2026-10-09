import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';

/** Keep drafts in memory. Never persist personal form values to device storage. */
export function useDraftExitGuard(dirty: boolean, busy = false) {
  const navigation = useNavigation();
  const allowExitRef = useRef(false);
  usePreventRemove(dirty || busy, ({ data }) => {
    if (allowExitRef.current) { navigation.dispatch(data.action); return; }
    if (busy) {
      Alert.alert('처리 중', '현재 작업이 끝난 뒤 이동해 주세요.');
      return;
    }
    Alert.alert('작성 내용 확인', '저장하지 않은 내용이 있습니다. 작성을 계속할까요?', [
      { text: '계속 작성', style: 'cancel' },
      { text: '내용 버리고 나가기', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (!dirty && !busy) return;
    if (Platform.OS === 'web') {
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (allowExitRef.current) return;
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', beforeUnload);
      return () => window.removeEventListener('beforeunload', beforeUnload);
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.canGoBack()) navigation.goBack();
      else Alert.alert('작성 중', '작성 내용을 저장하거나 화면의 뒤로 가기로 취소해 주세요.');
      return true;
    });
    return () => subscription.remove();
  }, [busy, dirty, navigation]);
  return () => { allowExitRef.current = true; };
}

import { useFocusEffect, useNavigation, usePreventRemove } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
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
    Alert.alert('작성 중인 내용을 버릴까요?', '저장하지 않은 내용은 사라져요.', [
      { text: '계속 작성', style: 'cancel' },
      { text: '버리고 나가기', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useFocusEffect(useCallback(() => {
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
      else if (busy) Alert.alert('처리 중', '현재 작업이 끝난 뒤 이동해 주세요.');
      // Root screen: back would close the app, so ask the same discard question.
      else Alert.alert('작성 중인 내용을 버릴까요?', '저장하지 않은 내용은 사라져요.', [
        { text: '계속 작성', style: 'cancel' },
        { text: '버리고 나가기', style: 'destructive', onPress: () => { allowExitRef.current = true; BackHandler.exitApp(); } },
      ]);
      return true;
    });
    return () => subscription.remove();
  }, [busy, dirty, navigation]));
  return () => { allowExitRef.current = true; };
}

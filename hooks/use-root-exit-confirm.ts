import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';

/** Android back on a root home asks before closing the app; with a back stack it navigates normally. */
export function useRootExitConfirm() {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const onBackPress = () => {
        if (router.canGoBack()) return false;
        Alert.alert(
          '앱을 종료할까요?',
          undefined,
          [
            { text: '취소', style: 'cancel' },
            { text: '종료', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ],
          { cancelable: true }
        );
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );
}

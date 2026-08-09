import { Alert, Platform, ToastAndroid } from 'react-native';

export const EXAM_MONTH_CONFLICT_MESSAGE =
  '같은 달에는 같은 보험 유형 시험을 한 번만 신청할 수 있습니다.';

export function showExamMonthConflictFeedback() {
  if (Platform.OS === 'android') {
    ToastAndroid.show(EXAM_MONTH_CONFLICT_MESSAGE, ToastAndroid.LONG);
    return;
  }

  Alert.alert('신청 불가', EXAM_MONTH_CONFLICT_MESSAGE);
}

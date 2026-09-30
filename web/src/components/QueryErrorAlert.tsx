'use client';

import { Alert, Button, Group, Text } from '@mantine/core';
import { requiresQueryLogin } from '@/lib/query-read-error';

type QueryErrorAlertProps = {
  error: unknown;
  onRetry: () => unknown;
  isFetching?: boolean;
  hasData?: boolean;
  subject?: string;
};

export function QueryErrorAlert({
  error, onRetry, isFetching = false, hasData = false, subject = '자료',
}: QueryErrorAlertProps) {
  const needsLogin = requiresQueryLogin(error);
  return (
    <Alert color="red" title={needsLogin ? '다시 로그인이 필요합니다.' : `${subject} 조회 실패`} role="alert">
      <Text size="sm">
        {needsLogin
          ? '로그인 상태를 확인하지 못했습니다. 다시 로그인한 후 이용해주세요.'
          : hasData
            ? '새로고침에 실패했습니다. 마지막으로 불러온 자료를 표시하고 있습니다.'
            : `${subject}를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.`}
      </Text>
      <Group mt="xs" gap="xs">
        <Button size="xs" color="red" variant="outline" loading={isFetching} onClick={() => { void onRetry(); }}>
          다시 시도
        </Button>
        {needsLogin && <Button size="xs" component="a" href="/auth" color="red">다시 로그인</Button>}
      </Group>
    </Alert>
  );
}

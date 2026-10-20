'use client';

import { Center, Loader } from '@mantine/core';

// Shown while the next dashboard route loads after a menu or link click.
export default function DashboardLoading() {
  return (
    <Center py={80} role="status" aria-label="불러오는 중">
      <Loader color="orange" />
    </Center>
  );
}

'use client';

import {
  Box,
  Container,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

/**
 * Simple parallax demo for Testsprite:
 * - Sticky hero banner with parallax background effect.
 * - Scrollable content with status/haptic-like labels.
 * - Keyboard-aware input near the bottom so focus keeps it visible on mobile/web.
 */
const HERO_HEIGHT = 260;

export default function ParallaxDemoPage() {
  const [scrollY, setScrollY] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollY(el.scrollTop);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const parallaxOffset = Math.min(scrollY / 2, HERO_HEIGHT / 2);

  return (
    <Container size="md" px="md" py="lg">
      <Paper withBorder shadow="sm" radius="lg" style={{ overflow: 'hidden' }}>
        <div
          style={{
            position: 'relative',
            height: HERO_HEIGHT,
            background:
              'linear-gradient(135deg, rgba(243,111,33,0.9), rgba(255,184,94,0.85))',
            transform: `translateY(${parallaxOffset * -0.5}px)`,
            transition: 'transform 60ms linear',
          }}
        >
          <Box
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              textAlign: 'center',
            }}
          >
            <Stack gap={4}>
              <Title order={2} c="white">
                Parallax & Keyboard Demo
              </Title>
              <Text size="sm" c="white" opacity={0.85}>
                스크롤하면 배경이 천천히 움직입니다. 아래 입력창에 포커스를 주면 화면 하단에 여유가 생깁니다.
              </Text>
            </Stack>
          </Box>
        </div>

        <ScrollArea h={520} viewportRef={scrollRef} px="lg" py="lg">
          <Stack gap="md">
            <Text fw={700} size="sm" c="dimmed">
              Status Toggles & Info
            </Text>
            <Paper withBorder p="md" radius="md">
              <Text size="sm" fw={600} mb={6}>
                단계 진행 상태
              </Text>
              <Text size="sm" c="dimmed">
                탭/스텝/토글 같은 UI를 여기에 배치할 수 있습니다. (예: 상태 토글, 하이라이트된 카드)
              </Text>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Text size="sm" fw={600} mb={10}>
                입력 필드 (Keyboard-aware)
              </Text>
              <Text size="xs" c="dimmed" mb={6}>
                아래 입력창을 클릭하면 키보드가 뜬다고 가정하고, 여백을 둬서 가려지지 않게 합니다.
              </Text>
              <Box mb={120}>
                <TextInput
                  label="메모"
                  placeholder="검색 또는 메모를 입력하세요"
                  size="md"
                  radius="md"
                  autoFocus={false}
                  styles={{
                    input: { paddingBlock: 12, fontSize: 14 },
                    label: { fontWeight: 600 },
                  }}
                />
              </Box>
            </Paper>
          </Stack>
        </ScrollArea>
      </Paper>
    </Container>
  );
}

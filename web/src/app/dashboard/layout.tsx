'use client';

import { useSession } from '@/hooks/use-session';
import { AppShell, Avatar, Burger, Group, Menu, NavLink, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBell,
  IconCalendarEvent,
  IconFileText,
  IconHome,
  IconLink,
  IconLogout,
  IconMessage,
  IconNews,
  IconSettings,
  IconUsers
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo } from 'react';

type NavItem = { label: string; href: string; icon: React.ComponentType<{ size?: number; stroke?: number }> };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const router = useRouter();
  const pathname = usePathname();
  const { role, logout, hydrated, displayName, residentMask } = useSession();

  const userInitial = displayName?.trim()?.[0] ?? (role === 'admin' ? '총' : 'F');
  const roleLabel = role === 'admin' ? '관리자' : 'FC';
  const subLabel = role === 'admin' ? '총무 계정' : residentMask || '전화번호 미등록';

  const navItems: NavItem[] = useMemo(
    () => [
      { label: '홈', icon: IconHome, href: '/dashboard' },
      { label: '문서 관리', icon: IconFileText, href: '/dashboard/docs' },
      { label: '위촉 진행', icon: IconLink, href: '/dashboard/appointment' },
      { label: '알림/공지', icon: IconBell, href: '/dashboard/notifications' },
      { label: '게시판', icon: IconNews, href: '/dashboard/board' },
      { label: '메신저 (채팅)', icon: IconMessage, href: '/dashboard/chat' },
      { label: '시험 일정', icon: IconCalendarEvent, href: '/dashboard/exam/schedule' },
      { label: '시험 신청자', icon: IconUsers, href: '/dashboard/exam/applicants' },
    ],
    [],
  );

  useEffect(() => {
    if (hydrated && !role) {
      router.replace('/auth');
    }
  }, [hydrated, role, router]);

  if (!hydrated || !role) {
    return null;
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={800} size="lg">
              FC 온보딩 웹
            </Text>
          </Group>

          <Menu shadow="md" width={220} position="bottom-end">
            <Menu.Target>
              <UnstyledButton>
                <Group gap="sm" wrap="nowrap">
                  <Avatar color="orange" radius="xl" size="sm">
                    {userInitial}
                  </Avatar>
                  <div>
                    <Text size="sm" fw={600} c="dark">
                      {displayName?.trim() || roleLabel}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {subLabel}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconSettings size={16} stroke={1.6} />}
                onClick={() => router.push('/dashboard/settings')}
              >
                설정
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconLogout size={16} stroke={1.6} />}
                onClick={logout}
              >
                로그아웃
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AppShell.Section grow>
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                label={item.label}
                active={active}
                leftSection={<Icon size={16} stroke={1.6} />}
                onClick={() => router.push(item.href)}
                variant="light"
              />
            );
          })}
        </AppShell.Section>

        <AppShell.Section>
          <NavLink
            label="로그아웃"
            color="red"
            leftSection={<IconLogout size={16} stroke={1.6} />}
            onClick={logout}
            variant="light"
          />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

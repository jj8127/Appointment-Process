'use client';

import { useSession } from '@/hooks/use-session';
import { DashboardNotificationBell } from '@/components/DashboardNotificationBell';
import { GlobalFcSearch } from '@/components/GlobalFcSearch';
import { NotificationReadAcknowledger } from '@/components/NotificationReadAcknowledger';
import { getDashboardRoleLabel, getDashboardRoleSubLabel } from '@/lib/staff-identity';
import { AppShell, Avatar, Box, Burger, Divider, Group, Menu, NavLink, Text, UnstyledButton, useMantineTheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconCalendarEvent,
  IconFileText,
  IconReceipt,
  IconClipboardList,
  IconGraph,
  IconHistory,
  IconHome,
  IconKey,
  IconLink,
  IconLogout,
  IconMessage,
  IconNews,
  IconSettings,
  IconSpeakerphone,
  IconUserPlus,
  IconUsers
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; stroke?: number }>;
};

type NavGroup = { label: string | null; items: NavItem[] };

// Chat screens open from the messenger menu.
const NAV_ALIASES: Record<string, string> = {
  '/dashboard/chat': '/dashboard/messenger',
  '/dashboard/group-chat': '/dashboard/messenger',
};

// The longest menu href that equals or contains the current path is active, so detail pages keep their menu lit.
function findActiveNavHref(pathname: string, hrefs: string[]): string | null {
  const path = NAV_ALIASES[pathname] ?? pathname;
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = path === href || (href !== '/dashboard' && path.startsWith(`${href}/`));
    if (matches && (!best || href.length > best.length)) best = href;
  }
  return best;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);

  // Desktop hover-expand behavior (collapsed by default).
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { role, logout, hydrated, displayName, residentMask, residentId, staffType, isReadOnly } = useSession();
  const isFcSession = role === 'fc';

  const roleLabel = getDashboardRoleLabel({ role, staffType, isReadOnly });
  const subLabel = getDashboardRoleSubLabel({ role, staffType, isReadOnly }) ?? (residentMask || '전화번호 미등록');
  const userInitial = displayName?.trim()?.[0] ?? roleLabel[0] ?? 'F';

  const navGroups: NavGroup[] = useMemo(
    () => {
      if (role === 'fc') {
        return [{ label: null, items: [
          { label: '추천인 그래프', icon: IconGraph, href: '/dashboard/referrals/graph' },
        ] }];
      }

      const canWrite = role === 'admin' && !isReadOnly;
      return [
        { label: null, items: [{ label: '홈', icon: IconHome, href: '/dashboard' }] },
        { label: '온보딩', items: [
          ...(canWrite ? [{ label: '서면확인 회원가입', icon: IconUserPlus, href: '/dashboard/fc-signup' }] : []),
          { label: '서류 관리', icon: IconFileText, href: '/dashboard/docs' },
          { label: '생명/손해 위촉', icon: IconLink, href: '/dashboard/appointment' },
        ] },
        { label: '시험', items: [
          { label: '시험 일정', icon: IconCalendarEvent, href: '/dashboard/exam/schedule' },
          { label: '시험 신청자', icon: IconClipboardList, href: '/dashboard/exam/applicants' },
        ] },
        { label: '소통', items: [
          { label: '공지사항', icon: IconSpeakerphone, href: '/dashboard/notifications' },
          { label: '게시판', icon: IconNews, href: '/dashboard/board' },
          { label: '메신저', icon: IconMessage, href: '/dashboard/messenger' },
        ] },
        { label: '추천·수당', items: [
          { label: '추천인 그래프', icon: IconGraph, href: '/dashboard/referrals/graph' },
          { label: '추천인 코드', icon: IconKey, href: '/dashboard/referrals' },
          ...(canWrite ? [{ label: '증원수당 관리', icon: IconReceipt, href: '/dashboard/referrals/allowances' }] : []),
        ] },
        ...(canWrite
          ? [{ label: '관리', items: [{ label: '처리 이력', icon: IconHistory, href: '/dashboard/audit' }] }]
          : []),
        ...(staffType === 'developer'
          ? [{ label: '개발', items: [{ label: '에이전트 룸', icon: IconUsers, href: '/dashboard/agent-room' }] }]
          : []),
      ];
    },
    [isReadOnly, role, staffType],
  );
  const activeHref = findActiveNavHref(pathname, navGroups.flatMap((group) => group.items.map((item) => item.href)));

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current != null) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hydrated || role !== 'fc') return;
    if (pathname !== '/dashboard/referrals/graph') {
      router.replace('/dashboard/referrals/graph');
    }
  }, [hydrated, pathname, role, router]);

  if (!hydrated || (role !== 'admin' && role !== 'manager' && role !== 'fc')) {
    return null;
  }

  const navbarExpanded = !isDesktop || desktopExpanded;
  const navbarWidth = isDesktop ? (navbarExpanded ? 260 : 72) : 260;

  const handleNavbarEnter = () => {
    if (!isDesktop) return;
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setDesktopExpanded(true);
  };

  const handleNavbarLeave = () => {
    if (!isDesktop) return;
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = window.setTimeout(() => {
      setDesktopExpanded(false);
    }, 140);
  };

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: navbarWidth, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <NotificationReadAcknowledger />
      <AppShell.Header>
        <Group h="100%" px={{ base: 8, sm: "md" }} justify="space-between" wrap="nowrap" gap={8}>
          <Group wrap="nowrap" gap={8} style={{ minWidth: 0, flex: 1 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={opened ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={opened} aria-controls="dashboard-navigation" styles={{ root: { width: 44, height: 44, flexShrink: 0 } }} />
            <Text fw={800} size="lg" truncate>
              {isFcSession ? 'FC 추천인 그래프' : 'FC 온보딩 웹'}
            </Text>
          </Group>

          <Group gap={isDesktop ? "sm" : 4} wrap="nowrap" style={{ flexShrink: 0 }}>
            {!isFcSession ? (
              <>
                <GlobalFcSearch role={role} residentId={residentId} />
                <DashboardNotificationBell role={role} residentId={residentId} staffType={staffType} />
              </>
            ) : null}

            <Menu shadow="md" width={220} position="bottom-end">
              <Menu.Target>
                <UnstyledButton aria-label={`${displayName?.trim() || roleLabel} 계정 메뉴`} style={{ minWidth: 44, minHeight: 44 }}>
                  <Group gap="sm" wrap="nowrap">
                    <Avatar color="orange" radius="xl" size="sm">
                      {userInitial}
                    </Avatar>
                    <Box visibleFrom="sm" maw={160}>
                      <Text size="sm" fw={600} c="dark" truncate>
                        {displayName?.trim() || roleLabel}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {subLabel}
                      </Text>
                    </Box>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {!isFcSession ? (
                  <Menu.Item
                    leftSection={<IconSettings size={16} stroke={2} />}
                    onClick={() => router.push('/dashboard/settings')}
                  >
                    설정
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  color="red"
                  leftSection={<IconLogout size={16} stroke={2} />}
                  onClick={() => logout()}
                >
                  로그아웃
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        id="dashboard-navigation"
        p={navbarExpanded ? 'md' : 'xs'}
        onMouseEnter={handleNavbarEnter}
        onMouseLeave={handleNavbarLeave}
        style={isDesktop ? { transition: 'width 160ms ease' } : undefined}
      >
        <AppShell.Section grow>
          {navGroups.map((group, groupIndex) => (
            <Box key={group.label ?? 'home'} component="nav" aria-label={group.label ?? '홈'}>
              {groupIndex > 0 && (navbarExpanded && group.label ? (
                <Text size="xs" fw={700} c="dimmed" px="sm" mt="md" mb={4}>{group.label}</Text>
              ) : (
                <Divider my={6} />
              ))}
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    label={navbarExpanded ? item.label : null}
                    active={active}
                    aria-current={active ? "page" : undefined}
                    leftSection={<Icon size={navbarExpanded ? 16 : 18} stroke={2} />}
                    onClick={() => router.push(item.href)}
                    variant="light"
                    aria-label={item.label}
                    title={!navbarExpanded ? item.label : undefined}
                    styles={
                      !navbarExpanded
                        ? {
                            root: { justifyContent: 'center' },
                            section: { marginInlineEnd: 0 },
                          }
                        : undefined
                    }
                  />
                );
              })}
            </Box>
          ))}
        </AppShell.Section>

        <AppShell.Section>
          <NavLink
            label={navbarExpanded ? '로그아웃' : null}
            color="red"
            leftSection={<IconLogout size={navbarExpanded ? 16 : 18} stroke={2} />}
            onClick={() => logout()}
            variant="light"
            aria-label="로그아웃"
            title={!navbarExpanded ? '로그아웃' : undefined}
            styles={
              !navbarExpanded
                ? {
                    root: { justifyContent: 'center' },
                    section: { marginInlineEnd: 0 },
                  }
                : undefined
            }
          />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

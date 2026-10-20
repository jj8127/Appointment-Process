'use client';

import { useSession } from '@/hooks/use-session';
import { DashboardNotificationBell } from '@/components/DashboardNotificationBell';
import { GlobalFcSearch } from '@/components/GlobalFcSearch';
import { NotificationReadAcknowledger } from '@/components/NotificationReadAcknowledger';
import { getDashboardRoleLabel, getDashboardRoleSubLabel } from '@/lib/staff-identity';
import { Avatar, Box, Burger, Center, Divider, Drawer, Group, Loader, Menu, NavLink, Text, Tooltip, UnstyledButton, useMantineTheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconCalendarEvent,
  IconChevronDown,
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
  IconSettings,
  IconSpeakerphone,
  IconUserPlus,
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './layout.module.css';

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; stroke?: number }>;
};

// Each group is one top tab; the left rail lists the active group's screens.
type NavGroup = { label: string; items: NavItem[] };

// Chat screens open from the messenger menu.
const NAV_ALIASES: Record<string, string> = {
  '/dashboard/chat': '/dashboard/messenger',
  '/dashboard/group-chat': '/dashboard/messenger',
  // Board posts open from the combined 공지·게시판 page.
  '/dashboard/board': '/dashboard/notifications',
};

// Group bar geometry; these match .groupTabs padding/gap and .groupTab padding in layout.module.css.
const GROUP_BAR_PADDING = 5;
const GROUP_TAB_GAP = 2;
const GROUP_TAB_PADDING = 20;
// Width of one page column while the full menu is open.
const MEGA_COLUMN_WIDTH = 176;

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
  const [opened, { toggle, close }] = useDisclosure();
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
  const router = useRouter();
  const pathname = usePathname();
  const { role, logout, hydrated, transitioning, displayName, residentMask, residentId, staffType, isReadOnly } = useSession();
  const isFcSession = role === 'fc';

  const roleLabel = getDashboardRoleLabel({ role, staffType, isReadOnly });
  const subLabel = getDashboardRoleSubLabel({ role, staffType, isReadOnly }) ?? (residentMask || '전화번호 미등록');
  const userInitial = displayName?.trim()?.[0] ?? roleLabel[0] ?? 'F';

  const navGroups: NavGroup[] = useMemo(
    () => {
      if (role === 'fc') {
        return [{ label: '추천인', items: [
          { label: '추천인 그래프', icon: IconGraph, href: '/dashboard/referrals/graph' },
        ] }];
      }

      const canWrite = role === 'admin' && !isReadOnly;
      const adminItems: NavItem[] = [
        ...(canWrite ? [{ label: '처리 이력', icon: IconHistory, href: '/dashboard/audit' }] : []),
      ];
      return [
        { label: '홈', items: [{ label: '홈', icon: IconHome, href: '/dashboard' }] },
        // The first item opens when the group tab is clicked, so the daily screens come first.
        { label: '업무', items: [
          { label: '서류 관리', icon: IconFileText, href: '/dashboard/docs' },
          { label: '생명/손해 위촉', icon: IconLink, href: '/dashboard/appointment' },
          { label: '시험 일정', icon: IconCalendarEvent, href: '/dashboard/exam/schedule' },
          { label: '시험 신청자', icon: IconClipboardList, href: '/dashboard/exam/applicants' },
          ...(canWrite ? [{ label: '서면확인 회원가입', icon: IconUserPlus, href: '/dashboard/fc-signup' }] : []),
        ] },
        { label: '사람', items: [
          { label: '추천인 그래프', icon: IconGraph, href: '/dashboard/referrals/graph' },
          { label: '추천인 코드', icon: IconKey, href: '/dashboard/referrals' },
          ...(canWrite ? [{ label: '증원수당 관리', icon: IconReceipt, href: '/dashboard/referrals/allowances' }] : []),
        ] },
        { label: '소통', items: [
          { label: '공지·게시판', icon: IconSpeakerphone, href: '/dashboard/notifications' },
          { label: '메신저', icon: IconMessage, href: '/dashboard/messenger' },
        ] },
        ...(adminItems.length ? [{ label: '관리', items: adminItems }] : []),
      ];
    },
    [isReadOnly, role],
  );
  const activeHref = findActiveNavHref(pathname, navGroups.flatMap((group) => group.items.map((item) => item.href)));
  // Pages outside the menu (FC 상세 is matched by href, 설정 is not) keep the home rail.
  const activeGroup = navGroups.find((group) => group.items.some((item) => item.href === activeHref)) ?? navGroups[0];

  useEffect(() => {
    close();
  }, [pathname, close]);

  // Hovering the group bar opens every group's pages at once. Each tab widens to its column,
  // so the bar and the panel below share one set of widths and the black pill can be computed, not measured mid-animation.
  const tabsRef = useRef<HTMLElement | null>(null);
  const [labelWidths, setLabelWidths] = useState<number[] | null>(null);
  const [megaOpen, setMegaOpen] = useState(false);
  const [hotGroup, setHotGroup] = useState<string | null>(null);
  const megaTimer = useRef<number | undefined>(undefined);
  const scheduleMega = (next: boolean, delay: number) => {
    window.clearTimeout(megaTimer.current);
    megaTimer.current = window.setTimeout(() => setMegaOpen(next), delay);
  };
  const closeMega = () => {
    window.clearTimeout(megaTimer.current);
    setMegaOpen(false);
  };
  useEffect(() => () => window.clearTimeout(megaTimer.current), []);
  useEffect(() => {
    const measure = () => {
      const labels = tabsRef.current?.querySelectorAll<HTMLElement>('[data-group] > span');
      setLabelWidths(labels?.length ? Array.from(labels, (label) => Math.ceil(label.getBoundingClientRect().width)) : null);
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [navGroups, isDesktop, hydrated]);
  const tabWidths = labelWidths?.map((width) => width + GROUP_TAB_PADDING * 2);
  const columnWidths = tabWidths?.map((width) => (megaOpen ? Math.max(width, MEGA_COLUMN_WIDTH) : width));
  // The closed bar keeps its place in the header; the open bar floats over its neighbours from the same centre.
  const closedBarWidth = tabWidths
    ? tabWidths.reduce((sum, width) => sum + width, 0) + GROUP_TAB_GAP * (tabWidths.length - 1) + GROUP_BAR_PADDING * 2
    : undefined;
  const activeIndex = navGroups.indexOf(activeGroup);
  const indicator = columnWidths && activeIndex >= 0
    ? {
        left: GROUP_BAR_PADDING + columnWidths.slice(0, activeIndex).reduce((sum, width) => sum + width + GROUP_TAB_GAP, 0),
        width: columnWidths[activeIndex],
      }
    : null;

  useEffect(() => {
    if (!hydrated || role !== 'fc') return;
    if (pathname !== '/dashboard/referrals/graph') {
      router.replace('/dashboard/referrals/graph');
    }
  }, [hydrated, pathname, role, router]);

  if (!hydrated || (role !== 'admin' && role !== 'manager' && role !== 'fc')) {
    // Logout clears the session at once; keep a spinner up until the redirect lands.
    return transitioning ? (
      <Center mih="100vh" role="status" aria-label="로그아웃 중">
        <Loader color="orange" />
      </Center>
    ) : null;
  }

  const showGroupTabs = isDesktop && navGroups.length > 1;
  const menuList = (
    <>
      {navGroups.map((group, groupIndex) => (
        <Box key={group.label} component="nav" aria-label={group.label}>
          {groupIndex > 0 ? (
            <Text size="xs" fw={700} c="dimmed" px="sm" mt="md" mb={4}>{group.label}</Text>
          ) : null}
          {group.items.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                label={item.label}
                active={active}
                aria-current={active ? "page" : undefined}
                leftSection={<Icon size={16} stroke={2} />}
                onClick={() => router.push(item.href)}
                variant="light"
              />
            );
          })}
        </Box>
      ))}
      <Divider my={6} />
      <NavLink
        label="로그아웃"
        color="red"
        leftSection={<IconLogout size={16} stroke={2} />}
        onClick={() => logout()}
        variant="light"
      />
    </>
  );

  return (
    // Three surfaces, as in the reference: page background, the rounded app panel, then white cards.
    <div className={styles.frame}>
      <NotificationReadAcknowledger />
      <div className={styles.panel}>
        <header className={styles.header}>
          <Group wrap="nowrap" gap={8} style={{ minWidth: 0, flex: 1 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label={opened ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={opened} aria-controls="dashboard-navigation" styles={{ root: { width: 44, height: 44, flexShrink: 0 } }} />
            <div className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true" />
              <Text fw={700} size="md" truncate>
                {isFcSession ? 'FC 추천인 그래프' : 'FC 온보딩 웹'}
              </Text>
            </div>
          </Group>

          {showGroupTabs ? (
            <div className={styles.megaSlot} style={{ width: closedBarWidth }}>
              <div
                className={styles.megaWrap}
                data-open={megaOpen || undefined}
                onMouseEnter={() => scheduleMega(true, 80)}
                onMouseLeave={() => { scheduleMega(false, 180); setHotGroup(null); }}
                onFocus={() => scheduleMega(true, 0)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMega();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeMega();
                }}
              >
                <nav aria-label="메뉴 묶음" className={styles.groupTabs} ref={tabsRef}>
                  <span className={styles.groupIndicator} style={indicator ?? { opacity: 0 }} aria-hidden="true" />
                  {navGroups.map((group, groupIndex) => (
                    <button
                      key={group.label}
                      type="button"
                      data-group={group.label}
                      data-hot={hotGroup === group.label || undefined}
                      className={styles.groupTab}
                      style={columnWidths ? { width: columnWidths[groupIndex] } : undefined}
                      aria-current={group === activeGroup ? 'true' : undefined}
                      aria-expanded={megaOpen}
                      aria-controls="dashboard-mega-menu"
                      onMouseEnter={() => setHotGroup(group.label)}
                      onClick={() => {
                        closeMega();
                        router.push(group.items[0].href);
                      }}
                    >
                      <span>{group.label}</span>
                    </button>
                  ))}
                </nav>
                {/* Every group's pages, one column under each tab. */}
                <nav
                  id="dashboard-mega-menu"
                  aria-label="전체 메뉴"
                  className={styles.megaPanel}
                  style={columnWidths ? { gridTemplateColumns: columnWidths.map((width) => `${width}px`).join(' ') } : undefined}
                  inert={!megaOpen}
                >
                  {navGroups.map((group, groupIndex) => (
                    <div
                      key={group.label}
                      className={styles.megaColumn}
                      data-hot={hotGroup === group.label || undefined}
                      onMouseEnter={() => setHotGroup(group.label)}
                    >
                      {group.items.map((item, itemIndex) => (
                        <button
                          key={item.href}
                          type="button"
                          className={styles.megaItem}
                          style={{ '--n': groupIndex + itemIndex } as React.CSSProperties}
                          aria-current={item.href === activeHref ? 'page' : undefined}
                          onClick={() => {
                            closeMega();
                            router.push(item.href);
                          }}
                        >
                          <item.icon size={17} stroke={1.7} />
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </nav>
              </div>
            </div>
          ) : null}

          <Group gap={isDesktop ? 10 : 4} wrap="nowrap" style={{ flexShrink: 0, flex: showGroupTabs ? 1 : undefined, justifyContent: 'flex-end' }}>
            {!isFcSession ? (
              <>
                <GlobalFcSearch role={role} residentId={residentId} />
                <span className={styles.iconCircle}>
                  <DashboardNotificationBell role={role} residentId={residentId} staffType={staffType} />
                </span>
              </>
            ) : null}

            <Menu shadow="md" width={220} position="bottom-end">
              <Menu.Target>
                <UnstyledButton className={styles.profile} aria-label={`${displayName?.trim() || roleLabel} 계정 메뉴`}>
                  <Avatar color="orange" radius="xl" size={32}>
                    {userInitial}
                  </Avatar>
                  <Box visibleFrom="sm" maw={160}>
                    <Text size="sm" fw={600} c="dark" truncate lh={1.25}>
                      {displayName?.trim() || roleLabel}
                    </Text>
                    <Text size="xs" c="dimmed" truncate lh={1.25}>
                      {subLabel}
                    </Text>
                  </Box>
                  <IconChevronDown size={14} stroke={2} className={styles.profileChevron} />
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
        </header>

        <div className={styles.body}>
          {isDesktop ? (
            <aside id="dashboard-navigation" className={styles.railColumn}>
              <nav aria-label={activeGroup.label} className={styles.rail}>
                {activeGroup.items.map((item) => {
                  const active = item.href === activeHref;
                  const Icon = item.icon;
                  return (
                    <Tooltip key={item.href} label={item.label} position="right" withArrow openDelay={150}>
                      <button
                        type="button"
                        className={styles.railItem}
                        aria-label={item.label}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => router.push(item.href)}
                      >
                        <Icon size={18} stroke={1.8} />
                      </button>
                    </Tooltip>
                  );
                })}
              </nav>
              <div className={styles.rail}>
                <Tooltip label="로그아웃" position="right" withArrow openDelay={150}>
                  <button type="button" className={`${styles.railItem} ${styles.railLogout}`} aria-label="로그아웃" onClick={() => logout()}>
                    <IconLogout size={18} stroke={1.8} />
                  </button>
                </Tooltip>
              </div>
            </aside>
          ) : (
            <Drawer opened={opened} onClose={close} size={280} title="메뉴" id="dashboard-navigation">
              {menuList}
            </Drawer>
          )}
          <main key={pathname} className={styles.main}>{children}</main>
        </div>
      </div>
    </div>
  );
}

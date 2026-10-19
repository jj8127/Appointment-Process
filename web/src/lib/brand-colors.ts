import type { MantineColorsTuple } from '@mantine/core';

export const HANWHA_ORANGE = '#f36f21';
export const HANWHA_ORANGE_DARK = '#d65a16';
export const CHARCOAL = '#111827';
export const MUTED = '#6b7280';

// Mantine's default orange shade 6 (#fd7e14) is replaced so buttons match HANWHA_ORANGE.
export const BRAND_ORANGE_TUPLE: MantineColorsTuple = [
  '#fff4e6',
  '#ffe8cc',
  '#ffd8a8',
  '#ffc078',
  '#ffa94d',
  '#ff922b',
  HANWHA_ORANGE,
  '#e5631a',
  HANWHA_ORANGE_DARK,
  '#b84a10',
];

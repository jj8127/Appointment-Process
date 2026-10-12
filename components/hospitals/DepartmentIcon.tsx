import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { COLORS } from '@/lib/theme';

// Shared geometry and palette, drawn for the 44px discovery tiles.
const INK = '#216B78';
const TEAL = '#9AD6D7';
const ORANGE = COLORS.primaryLight;

export function DepartmentIcon({ specialty, size = 44 }: { specialty: string; size?: number }) {
  let artwork: ReactNode;

  switch (specialty) {
    case '내과':
      artwork = <>
        <Path d="M14 14v13c0 8 5 13 13 13s13-5 13-13V14" strokeWidth={5} />
        <Path d="M27 40v3c0 7 4 11 11 11s11-4 11-11v-7" strokeWidth={3.2} />
        <Rect x={10} y={9} width={8} height={12} rx={4} fill={TEAL} />
        <Rect x={36} y={9} width={8} height={12} rx={4} fill={TEAL} />
        <Circle cx={49} cy={29} r={9} fill={ORANGE} />
        <Circle cx={49} cy={29} r={3.5} fill="white" stroke="none" />
      </>;
      break;
    case '정형외과':
      artwork = <G rotation={-35} origin="32,32">
        <Path d="M26 21c-7 3-13-5-9-10 4-5 9-2 15 3 6-5 11-8 15-3 4 5-2 13-9 10v22c7-3 13 5 9 10-4 5-9 2-15-3-6 5-11 8-15 3-4-5 2-13 9-10Z" fill={TEAL} />
        <Path d="M26 29h12v7H26Z" fill={ORANGE} stroke="none" />
        <Path d="M30 22v4M30 39v4" stroke="white" strokeWidth={3.2} />
      </G>;
      break;
    case '재활의학과':
      artwork = <>
        <Path d="M23 9h12l5 17c1 4 0 8-3 11l-8 8 1 10H17l-1-14c0-4 1-7 4-10l7-8Z" fill={TEAL} />
        <Circle cx={29} cy={33} r={7} fill={ORANGE} />
        <Path d="M42 16c9 5 12 13 9 21M46 34l5 3 4-5" strokeWidth={3.2} />
      </>;
      break;
    case '치과':
      artwork = <>
        <Path d="M13 18c3-10 12-11 19-6 7-5 16-4 19 6 3 9-3 16-5 23-2 9-4 14-8 14-4 0-3-14-6-14s-2 14-6 14c-4 0-6-5-8-14-2-7-8-14-5-23Z" fill={TEAL} />
        <Path d="M19 18c3-3 6-3 10-1 2 1 4 1 6 0 4-2 7-2 10 1" stroke="white" strokeWidth={3.2} />
        <Path d="M47 29v10M42 34h10" stroke={ORANGE} strokeWidth={4} />
      </>;
      break;
    case '안과':
      artwork = <>
        <Path d="M8 32c6-10 14-15 24-15s18 5 24 15c-6 10-14 15-24 15S14 42 8 32Z" fill="white" />
        <Circle cx={32} cy={32} r={12} fill={TEAL} />
        <Circle cx={32} cy={32} r={6} fill={INK} stroke="none" />
        <Circle cx={36} cy={28} r={3} fill="white" stroke="none" />
        <Path d="M32 9v3M14 14l3 3M50 14l-3 3" stroke={ORANGE} strokeWidth={3.2} />
      </>;
      break;
    case '피부과':
      artwork = <>
        <Path d="M34 9c-12 0-20 9-19 20l-5 9 8 3v8c0 5 4 7 10 6l12-3V41c9-5 14-15 10-23-3-6-9-9-16-9Z" fill={TEAL} />
        <Path d="M21 26h6" />
        <Circle cx={33} cy={37} r={6} fill={ORANGE} stroke="none" />
        <Path d="M27 16c3-2 6-3 10-2" stroke="white" strokeWidth={3.2} />
      </>;
      break;
    case '소아과':
    case '소아청소년과':
      artwork = <>
        <Path d="M14 56c1-9 8-15 18-15s17 6 18 15" fill={TEAL} />
        <Circle cx={15} cy={29} r={4} fill={TEAL} />
        <Circle cx={49} cy={29} r={4} fill={TEAL} />
        <Circle cx={32} cy={27} r={17} fill="white" />
        <Path d="M24 12c4-6 12-7 14-2 1 4-2 7-6 6" />
        <Circle cx={26} cy={27} r={2} fill={INK} stroke="none" />
        <Circle cx={38} cy={27} r={2} fill={INK} stroke="none" />
        <Path d="M27 34c3 3 7 3 10 0" />
        <Circle cx={22} cy={33} r={3} fill={ORANGE} stroke="none" />
        <Circle cx={42} cy={33} r={3} fill={ORANGE} stroke="none" />
      </>;
      break;
    case '이비인후과':
      artwork = <>
        <Path d="M22 47c-6-5-9-14-7-24 3-13 14-17 24-12 12 6 13 20 5 29-5 5-5 14-12 15-5 1-7-4-10-8Z" fill={TEAL} />
        <Path d="M24 25c1-8 11-10 16-4 4 6 0 11-5 13l-6 3c-3 2-2 6 1 7" strokeWidth={3.2} />
        <Circle cx={31} cy={28} r={4} fill={ORANGE} stroke="none" />
      </>;
      break;
    case '신경과':
    case '신경외과':
      artwork = <>
        <Path d="M32 13c-4-6-13-4-15 3-7 0-11 8-7 14-5 6-2 14 4 16 0 8 10 12 18 6 8 6 18 2 18-6 6-2 9-10 4-16 4-6 0-14-7-14-2-7-11-9-15-3Z" fill={TEAL} />
        <Path d="M32 14v37M18 23c6 0 8 4 8 8M14 38c7-3 12 0 12 6M46 23c-6 0-8 4-8 8M50 38c-7-3-12 0-12 6" />
        <Circle cx={32} cy={32} r={5} fill={ORANGE} stroke="none" />
      </>;
      break;
    case '산부인과':
      artwork = <>
        <Path d="M22 26c-4-10-11-12-14-8-4 6 0 13 8 12M42 26c4-10 11-12 14-8 4 6 0 13-8 12" strokeWidth={3.2} />
        <Path d="M22 21c6 4 14 4 20 0 5 7 3 14-3 19l-3 14h-8l-3-14c-6-5-8-12-3-19Z" fill={TEAL} />
        <Path d="M25 29c4 2 10 2 14 0l-7 11Z" fill={ORANGE} stroke="none" />
      </>;
      break;
    default:
      artwork = <>
        <Rect x={10} y={10} width={44} height={44} rx={13} fill="#EEF4F5" stroke="none" />
        <Path d="M26 19h12v7h7v12h-7v7H26v-7h-7V26h7Z" fill={INK} stroke="none" />
      </>;
  }

  return <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" accessible={false}>
    <G stroke={INK} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">{artwork}</G>
  </Svg>;
}

export default DepartmentIcon;

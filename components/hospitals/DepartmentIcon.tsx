import { useId, type ReactNode } from 'react';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { COLORS } from '@/lib/theme';

// Shared geometry and palette, drawn for the 44px discovery tiles.
const INK = '#216B78';
const TEAL = '#9AD6D7';
const ORANGE = COLORS.primaryLight;
const LEAF_OUTLINE = 'M15 47c1-17 11-29 30-31-1 19-11 30-30 31Z';

export function DepartmentIcon({ specialty, size = 44 }: { specialty: string; size?: number }) {
  let artwork: ReactNode;
  const leafClipId = useId();

  switch (specialty) {
    case '한방병원':
      artwork = <>
        <Defs><ClipPath id={leafClipId}><Path d={LEAF_OUTLINE} fill="white" stroke="none" /></ClipPath></Defs>
        <Path d={LEAF_OUTLINE} fill={TEAL} />
        <G clipPath={`url(#${leafClipId})`}><Path d="M19 43l21-20M28 35l-3-7M33 31l7 1" /></G>
        <Circle cx={47} cy={46} r={9} fill={ORANGE} />
        <Path d="M47 41v10M42 46h10" stroke="white" strokeWidth={3.2} />
      </>;
      break;
    case '정형외과':
      artwork = <G rotation={-35} origin="32,32">
        <Path d="M26 21c-7 3-13-5-9-10 4-5 9-2 15 3 6-5 11-8 15-3 4 5-2 13-9 10v22c7-3 13 5 9 10-4 5-9 2-15-3-6 5-11 8-15 3-4-5 2-13 9-10Z" fill={TEAL} />
        <Path d="M26 29h12v7H26Z" fill={ORANGE} stroke="none" />
        <Path d="M30 22v4M30 39v4" stroke="white" strokeWidth={3.2} />
      </G>;
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
    case '성형외과':
      artwork = <>
        <Path d="M34 9c-12 0-20 9-19 20l-5 9 8 3v8c0 5 4 7 10 6l12-3V41c9-5 14-15 10-23-3-6-9-9-16-9Z" fill={TEAL} />
        <Path d="M49 15v10M44 20h10" stroke={ORANGE} strokeWidth={3.6} />
      </>;
      break;
    case '건강검진센터':
      artwork = <>
        <Rect x={14} y={11} width={36} height={45} rx={8} fill={TEAL} />
        <Rect x={23} y={7} width={18} height={10} rx={4} fill={ORANGE} stroke="none" />
        <Path d="m23 32 6 6 12-13" stroke="white" strokeWidth={4} />
        <Path d="M23 47h18" />
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

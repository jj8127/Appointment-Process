import Svg, { Circle, Line, Path } from 'react-native-svg';

type StatusGlyphVariant = 'info' | 'success' | 'warning' | 'error';

type StatusGlyphProps = {
  variant: StatusGlyphVariant;
  size?: number;
  color: string;
};

export default function StatusGlyph({
  variant,
  size = 20,
  color,
}: StatusGlyphProps) {
  switch (variant) {
    case 'success':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12.5L9.5 17L19 7.5"
            stroke={color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'warning':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 4L20 19H4L12 4Z"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Line
            x1="12"
            y1="9"
            x2="12"
            y2="13"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Circle cx="12" cy="16.5" r="1.1" fill={color} />
        </Svg>
      );
    case 'error':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={2} />
          <Line
            x1="9"
            y1="9"
            x2="15"
            y2="15"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Line
            x1="15"
            y1="9"
            x2="9"
            y2="15"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </Svg>
      );
    case 'info':
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Line
            x1="12"
            y1="10"
            x2="12"
            y2="16"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Circle cx="12" cy="7" r="1.3" fill={color} />
        </Svg>
      );
  }
}

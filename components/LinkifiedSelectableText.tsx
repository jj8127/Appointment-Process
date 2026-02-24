import * as Clipboard from 'expo-clipboard';
import { useMemo } from 'react';
import { Alert, Linking, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s]+)/gi;

type TextSegment = {
  text: string;
  isLink: boolean;
};

type LinkifiedSelectableTextProps = {
  text?: string | null;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
};

function normalizeUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function splitTextByLinks(input: string): TextSegment[] {
  if (!input) return [{ text: '', isLink: false }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  const matches = input.matchAll(URL_PATTERN);

  for (const match of matches) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ text: input.slice(cursor, index), isLink: false });
    }
    segments.push({ text: value, isLink: true });
    cursor = index + value.length;
  }

  if (cursor < input.length) {
    segments.push({ text: input.slice(cursor), isLink: false });
  }

  return segments.length > 0 ? segments : [{ text: input, isLink: false }];
}

export function LinkifiedSelectableText({
  text,
  style,
  linkStyle,
  numberOfLines,
  selectable = true,
}: LinkifiedSelectableTextProps) {
  const safeText = text ?? '';
  const segments = useMemo(() => splitTextByLinks(safeText), [safeText]);

  const handleLinkPress = (rawUrl: string) => {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return;

    Alert.alert('링크 옵션', normalized, [
      {
        text: '열기',
        onPress: () => {
          Linking.openURL(normalized).catch(() => {
            Alert.alert('오류', '링크를 열 수 없습니다.');
          });
        },
      },
      {
        text: '복사',
        onPress: async () => {
          try {
            await Clipboard.setStringAsync(normalized);
            Alert.alert('복사 완료', '링크를 클립보드에 복사했습니다.');
          } catch {
            Alert.alert('복사 실패', '링크 복사에 실패했습니다.');
          }
        },
      },
      {
        text: '선택/부분선택',
        onPress: () => {
          Alert.alert('안내', '본문을 길게 누르면 텍스트를 선택할 수 있습니다.');
        },
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  return (
    <Text style={style} numberOfLines={numberOfLines} selectable={selectable}>
      {segments.map((segment, index) => (
        segment.isLink ? (
          <Text
            key={`link-${index}`}
            style={[styles.linkText, linkStyle]}
            onPress={() => handleLinkPress(segment.text)}
            suppressHighlighting
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={`text-${index}`}>{segment.text}</Text>
        )
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  linkText: {
    color: '#2563eb',
    textDecorationLine: 'underline',
  },
});

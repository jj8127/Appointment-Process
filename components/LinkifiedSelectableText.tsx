import { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import {
  formatExternalUrlDisplayText,
  normalizeExternalUrl,
  stripTrailingUrlPunctuation,
} from '@/lib/external-url';
import {
  openLinkExternallyWithFeedback,
  showLinkifiedTextOptions,
} from '@/lib/linkified-text-actions';

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
  linkPressBehavior?: 'options' | 'open';
};

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
    const linkText = stripTrailingUrlPunctuation(value);
    const trailingText = value.slice(linkText.length);
    if (linkText) {
      segments.push({ text: linkText, isLink: true });
    }
    if (trailingText) {
      segments.push({ text: trailingText, isLink: false });
    }
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
  linkPressBehavior = 'options',
}: LinkifiedSelectableTextProps) {
  const safeText = text ?? '';
  const segments = useMemo(() => splitTextByLinks(safeText), [safeText]);
  const hasLinks = segments.some((segment) => segment.isLink);
  const textSelectable = selectable && !hasLinks;
  const nonSelectableStyle = textSelectable ? undefined : styles.nonSelectableText;

  const handleLinkPress = (rawUrl: string) => {
    const normalized = normalizeExternalUrl(rawUrl);
    if (!normalized) return;

    if (linkPressBehavior === 'open') {
      void openLinkExternallyWithFeedback(normalized);
      return;
    }

    showLinkifiedTextOptions(normalized);
  };

  return (
    <Text style={[style, nonSelectableStyle]} numberOfLines={numberOfLines} selectable={textSelectable}>
      {segments.map((segment, index) => (
        segment.isLink ? (
          <Text
            key={`link-${index}`}
            style={[styles.linkText, linkStyle, nonSelectableStyle]}
            onPress={() => handleLinkPress(segment.text)}
            selectable={false}
            suppressHighlighting
          >
            {formatExternalUrlDisplayText(segment.text)}
          </Text>
        ) : (
          <Text key={`text-${index}`} style={nonSelectableStyle} selectable={textSelectable}>
            {segment.text}
          </Text>
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
  nonSelectableText: {
    userSelect: 'none',
  },
});

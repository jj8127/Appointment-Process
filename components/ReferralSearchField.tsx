import type { Ref } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import BrandedLoadingSpinner from '@/components/BrandedLoadingSpinner';
import { COLORS, RADIUS } from '@/lib/theme';

export const REFERRAL_SEARCH_PLACEHOLDER = '이름, 소속 또는 추천 코드 입력';
export const REFERRAL_SEARCH_MIN_CHARS_HINT = '2글자 이상 입력하면 검색돼요';
export const REFERRAL_SEARCH_EMPTY_HINT = '검색 결과가 없어요';

export type ReferralSearchResult = {
  fcId: string;
  name: string;
  affiliation: string;
  code: string | null;
};

type ReferralSearchFieldProps = {
  searchQuery: string;
  searching: boolean;
  onChangeText: (text: string) => void;
  onClear: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  inputRef?: Ref<TextInput>;
  textInputProps?: Omit<
    TextInputProps,
    'value' | 'onChangeText' | 'placeholder' | 'placeholderTextColor' | 'returnKeyType'
  >;
};

type ReferralSearchResultListProps = {
  results: ReferralSearchResult[];
  onSelect: (item: ReferralSearchResult) => void;
  showNoCodeFallback?: boolean;
};

export function ReferralSearchField({
  searchQuery,
  searching,
  onChangeText,
  onClear,
  returnKeyType = 'search',
  inputRef,
  textInputProps,
}: ReferralSearchFieldProps) {
  return (
    <View style={styles.searchInputWrap}>
      <Feather name="search" size={16} color={COLORS.text.muted} />
      <TextInput
        ref={inputRef}
        style={styles.searchInputField}
        placeholder={REFERRAL_SEARCH_PLACEHOLDER}
        placeholderTextColor={COLORS.text.muted}
        value={searchQuery}
        onChangeText={onChangeText}
        autoCapitalize="none"
        returnKeyType={returnKeyType}
        {...textInputProps}
      />
      {searching && (
        <BrandedLoadingSpinner size="sm" color={COLORS.primary} style={{ marginLeft: 4 }} />
      )}
      {searchQuery.length > 0 && !searching && (
        <Pressable onPress={onClear} hitSlop={8}>
          <Feather name="x" size={16} color={COLORS.text.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function ReferralSearchResultList({
  results,
  onSelect,
  showNoCodeFallback = false,
}: ReferralSearchResultListProps) {
  return (
    <View style={styles.resultsList}>
      {results.map((item, index) => (
        <Pressable
          key={item.fcId}
          style={({ pressed }) => [
            styles.resultItem,
            index === results.length - 1 && styles.resultItemLast,
            pressed && styles.resultItemPressed,
          ]}
          onPress={() => onSelect(item)}
        >
          <View style={styles.resultAvatar}>
            <Feather name="user" size={14} color={COLORS.gray[500]} />
          </View>
          <View style={styles.resultInfo}>
            <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.resultAffiliation} numberOfLines={1}>{item.affiliation}</Text>
          </View>
          {item.code ? (
            <View style={styles.resultCodeBadge}>
              <Text style={styles.resultCodeText}>{item.code}</Text>
            </View>
          ) : showNoCodeFallback ? (
            <Text style={styles.resultNoCode}>코드 없음</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.background.secondary,
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 6,
  },
  searchInputField: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text.primary,
  },
  resultsList: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: 8,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  resultItemLast: {
    borderBottomWidth: 0,
  },
  resultItemPressed: {
    backgroundColor: COLORS.background.secondary,
  },
  resultAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text.primary,
  },
  resultAffiliation: {
    fontSize: 12,
    color: COLORS.text.muted,
    marginTop: 1,
  },
  resultCodeBadge: {
    backgroundColor: COLORS.primaryPale,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
  },
  resultCodeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  resultNoCode: {
    fontSize: 11,
    color: COLORS.text.muted,
  },
});

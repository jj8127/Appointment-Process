import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ReferralGraphCanvas } from '../../../components/referral-graph/ReferralGraphCanvas';
import type { ReferralGraphNode } from '../../../types/referral-graph';
import { syntheticReferralGraph } from './synthetic-graph';

const graph = syntheticReferralGraph();

/** Offline native QA entry. It never imports the router, authentication, or API client. */
export default function ReferralGraphEmulator() {
  const [selected, setSelected] = useState<ReferralGraphNode | null>(null);
  const [fit, setFit] = useState(0);
  const [reset, setReset] = useState(0);
  const [mount, setMount] = useState(0);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <StatusBar barStyle="dark-content" />
          <View style={styles.header}>
            <Text style={styles.title}>추천 그래프 · 에뮬레이터 검증</Text>
            <Text>가상 조직도 · 300명 / 299개 연결 · 완전 합성 데이터</Text>
            <Text>실제 앱 그래프 컴포넌트 · 오프라인 데이터</Text>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="화면 맞춤" style={styles.button} onPress={() => setFit((n) => n + 1)}><Text>화면 맞춤</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="초기화" style={styles.button} onPress={() => { setSelected(null); setReset((n) => n + 1); }}><Text>초기화</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="다시 열기" style={styles.button} onPress={() => { setSelected(null); setMount((n) => n + 1); }}><Text>다시 열기</Text></Pressable>
            </View>
          </View>
          <View style={styles.graph}>
            <ReferralGraphCanvas key={mount} {...graph} selectedNodeId={selected?.id ?? null} onSelectNode={setSelected} fitRequestId={fit} resetRequestId={reset} />
          </View>
          <View style={styles.footer}>
            <Text testID="selection-result">{selected ? `선택: ${selected.id} · 하위 ${selected.totalDescendantCount}명` : '선택 없음 · 노드를 누르면 이곳에 표시됩니다.'}</Text>
            <Text>한 손가락 이동 · 두 손가락 확대/축소</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 14, gap: 6 },
  title: { fontSize: 19, fontWeight: '700', color: '#0f172a' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: '#ffffff', borderColor: '#cbd5e1', borderWidth: 1 },
  graph: { flex: 1, marginHorizontal: 12, overflow: 'hidden', borderRadius: 16 },
  footer: { padding: 14, gap: 6 },
});

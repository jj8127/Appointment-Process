'use client';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import {
  Button,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Select,
  Title,
} from '@mantine/core';
import { DateInput, type DateValue } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type FormState = {
  exam_date: DateValue;
  registration_deadline: DateValue;
  round_label: string;
  notes: string;
  exam_type: 'life' | 'nonlife' | null;
  status: 'open' | 'closed';
  locations: string[];
};

export default function ExamNewPage() {
  const { role, hydrated } = useSession();
  const router = useRouter();
  const [state, setState] = useState<FormState>({
    exam_date: new Date(),
    registration_deadline: new Date(),
    round_label: '',
    notes: '',
    exam_type: null,
    status: 'open',
    locations: ['서울', '부산'],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hydrated && role !== 'admin') router.replace('/auth');
  }, [hydrated, role, router]);

  const handleSave = async () => {
    if (!state.exam_type) {
      notifications.show({ title: '시험 종류 선택', message: '생명/손해 중 하나를 선택하세요.', color: 'red' });
      return;
    }
    if (!state.exam_date || !state.registration_deadline || !state.round_label.trim()) {
      notifications.show({ title: '입력 확인', message: '필수 항목을 입력하세요.', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        exam_date: dayjs(state.exam_date).format('YYYY-MM-DD'),
        registration_deadline: dayjs(state.registration_deadline).format('YYYY-MM-DD'),
        round_label: state.round_label.trim(),
        notes: state.notes,
        exam_type: state.exam_type,
        status: state.status,
      };
      const { data: round, error } = await supabase.from('exam_rounds').insert(payload).select().single();
      if (error) throw error;
      const roundId = round.id as string;

      const toInsert = state.locations
        .filter((name) => name.trim().length > 0)
        .map((name, idx) => ({
          round_id: roundId,
          location_name: name.trim(),
          sort_order: idx,
        }));

      if (toInsert.length > 0) {
        const { error: locErr } = await supabase.from('exam_locations').insert(toInsert);
        if (locErr) throw locErr;
      }

      notifications.show({ title: '등록 완료', message: '시험 일정이 등록되었습니다.', color: 'green' });
      router.replace('/dashboard/exam/schedule');
    } catch (e) {
      const err = e as Error;
      notifications.show({ title: '등록 실패', message: err.message ?? '오류가 발생했습니다.', color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  if (!hydrated) return null;

  return (
    <Container size="md" py="lg">
      <Paper withBorder radius="md" shadow="sm" p="lg">
        <Stack gap="md">
          <Title order={3}>시험 일정 등록</Title>
          <SegmentedControl
            fullWidth
            radius="md"
            value={state.exam_type ?? undefined}
            onChange={(v) => setState((s) => ({ ...s, exam_type: (v as 'life' | 'nonlife') ?? null }))}
            data={[
              { label: '생명 / 제3보험', value: 'life' },
              { label: '손해보험', value: 'nonlife' },
            ]}
          />
          <Group grow>
            <DateInput
              label="시험일"
              value={state.exam_date}
              onChange={(v) => setState((s) => ({ ...s, exam_date: v }))}
              valueFormat="YYYY년 MM월 DD일"
            />
            <DateInput
              label="접수 마감일"
              value={state.registration_deadline}
              onChange={(v) => setState((s) => ({ ...s, registration_deadline: v }))}
              valueFormat="YYYY년 MM월 DD일"
            />
          </Group>
          <Group grow>
            <TextInput
              label="회차명/구분"
              placeholder="예: 312회차 생명보험"
              value={state.round_label}
              onChange={(e) => setState((s) => ({ ...s, round_label: e.currentTarget.value }))}
            />
            <Select
              label="시험 종류"
              data={[
                { value: 'life', label: '생명보험 (life)' },
                { value: 'nonlife', label: '손해보험 (nonlife)' },
              ]}
              value={state.exam_type}
              onChange={(v) => setState((s) => ({ ...s, exam_type: (v as 'life' | 'nonlife') || 'life' }))}
            />
            <Select
              label="상태"
              data={[
                { value: 'open', label: '접수 중 (open)' },
                { value: 'closed', label: '마감 (closed)' },
              ]}
              value={state.status}
              onChange={(v) => setState((s) => ({ ...s, status: (v as 'open' | 'closed') || 'open' }))}
            />
          </Group>
          <TextInput
            label="비고"
            placeholder="메모"
            value={state.notes}
            onChange={(e) => setState((s) => ({ ...s, notes: e.currentTarget.value }))}
          />
          <div>
            <Text size="sm" fw={600} mb={4}>
              고사장(장소)
            </Text>
            <TagsInput
              value={state.locations}
              onChange={(v) => setState((s) => ({ ...s, locations: v }))}
              placeholder="Enter 로 추가"
              data={['서울', '부산', '대구', '대전', '광주', '제주']}
            />
          </div>
          <Group justify="flex-end">
            <Button onClick={handleSave} loading={saving} color="orange">
              등록
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}

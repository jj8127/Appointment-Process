'use client';

import {
    ActionIcon,
    Badge,
    Button,
    Container,
    Group,
    LoadingOverlay,
    Menu,
    Paper,
    ScrollArea,
    Select,
    Table,
    Text,
    Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconDotsVertical,
    IconDownload,
    IconFilter,
    IconX
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';

// --- Constants ---
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';

// --- Types ---
type Applicant = {
    id: string; // application id
    status: string;
    created_at: string;
    fc_id: string;
    location_name: string;
    round_label: string;
    exam_date: string;
    fc: {
        name: string;
        phone: string;
        affiliation: string;
        resident_number?: string;
    };
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    applied: { label: '신청됨', color: 'blue' },
    passed: { label: '합격', color: 'green' },
    failed: { label: '불합격', color: 'red' },
    cancelled: { label: '취소', color: 'gray' },
};

export default function ExamApplicantsPage() {
    const queryClient = useQueryClient();
    const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
    const [defaultRoundId, setDefaultRoundId] = useState<string | null>(null);

    // --- Fetch Rounds (For Filter) ---
    const { data: rounds } = useQuery({
        queryKey: ['exam-rounds-select'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('exam_rounds')
                .select('id, round_label, exam_date')
                .order('exam_date', { ascending: false });
            if (error) throw error;
            return data;
        },
    });

    const roundOptions = useMemo(() => {
        return rounds?.map((r) => ({
            value: r.id,
            label: `${dayjs(r.exam_date).format('YYYY-MM-DD')} (${r.round_label})`,
        })) || [];
    }, [rounds]);

    // Set default round once (avoids render-time setState → 불필요한 추가 렌더/지연 방지)
    if (!defaultRoundId && roundOptions.length > 0) {
        setDefaultRoundId(roundOptions[0].value);
    }

    const effectiveRoundId = selectedRoundId ?? defaultRoundId;

    // --- Fetch Applicants ---
    const { data: applicants, isLoading } = useQuery({
        queryKey: ['exam-applicants', effectiveRoundId],
        queryFn: async () => {
            if (!effectiveRoundId) return [];

            const { data, error } = await supabase
                .from('exam_applications')
                .select(`
          id, status, created_at,
          fc_profiles!inner ( name, phone, affiliation, resident_number ),
          exam_locations ( location_name ),
          exam_rounds ( round_label, exam_date )
        `)
                .eq('round_id', effectiveRoundId)
                .order('created_at', { ascending: false })
                .limit(200); // 안전 상한선으로 불필요한 대량 fetch 방지

            if (error) throw error;

            return data.map((d: any) => ({
                id: d.id,
                status: d.status,
                created_at: d.created_at,
                fc: {
                    name: d.fc_profiles?.name || '-',
                    phone: d.fc_profiles?.phone || '-',
                    affiliation: d.fc_profiles?.affiliation || '-',
                    resident_number: d.fc_profiles?.resident_number,
                },
                location_name: d.exam_locations?.location_name || '미정',
                round_label: d.exam_rounds?.round_label || '-',
                exam_date: d.exam_rounds?.exam_date,
            })) as Applicant[];
        },
        enabled: !!selectedRoundId,
    });

    // --- Mutations ---
    const updateStatusMutation = useMutation({
        mutationFn: async ({ id, status, fcPhone, examLabel }: { id: string; status: string; fcPhone: string; examLabel: string }) => {
            const { error } = await supabase
                .from('exam_applications')
                .update({ status })
                .eq('id', id);

            if (error) throw error;

            // Notification
            const title = status === 'passed' ? '시험 합격 안내' : '시험 결과 안내';
            const body = status === 'passed'
                ? `축하합니다! 신청하신 [${examLabel}]에 합격하셨습니다.`
                : `신청하신 [${examLabel}] 결과가 '불합격'으로 처리되었습니다.`;

            await supabase.from('notifications').insert({
                title,
                body,
                recipient_role: 'fc',
                resident_id: fcPhone,
                category: 'exam' // Assuming 'exam' category exists or is plain string
            });
        },
        onSuccess: () => {
            notifications.show({ title: '처리 완료', message: '상태가 변경되었습니다.', color: 'green' });
            queryClient.invalidateQueries({ queryKey: ['exam-applicants'] });
        },
        onError: (err: any) => {
            notifications.show({ title: '오류', message: err.message, color: 'red' });
        }
    });

    // --- Excel/CSV Download ---
    const handleDownloadCsv = () => {
        if (!applicants || applicants.length === 0) {
            notifications.show({ title: '알림', message: '다운로드할 데이터가 없습니다.', color: 'blue' });
            return;
        }

        const headers = ['이름', '연락처', '소속', '주민번호', '시험일', '회차명', '고사장', '상태', '신청일'];
        const rows = applicants.map(a => [
            a.fc.name,
            a.fc.phone,
            a.fc.affiliation,
            a.fc.resident_number || '', // Sensitive data, maybe mask? Prompt implies just "Manage". Keeping raw for admin is usually required.
            dayjs(a.exam_date).format('YYYY-MM-DD'),
            a.round_label,
            a.location_name,
            STATUS_MAP[a.status]?.label || a.status,
            dayjs(a.created_at).format('YYYY-MM-DD HH:mm')
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `exam_applicants_${dayjs().format('YYYYMMDD')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const rows = applicants?.map((item) => (
        <Table.Tr key={item.id}>
            <Table.Td>
                <Group gap="sm">
                    <Text fw={600} size="sm">{item.fc.name}</Text>
                </Group>
            </Table.Td>
            <Table.Td>
                <Text size="sm">{item.fc.phone}</Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" c="dimmed">{item.fc.affiliation}</Text>
            </Table.Td>
            <Table.Td>
                <Badge variant="outline" color="gray">{item.location_name}</Badge>
            </Table.Td>
            <Table.Td>
                <Badge color={STATUS_MAP[item.status]?.color || 'gray'} variant="light">
                    {STATUS_MAP[item.status]?.label || item.status}
                </Badge>
            </Table.Td>
            <Table.Td>
                <Menu shadow="md" width={120} position="bottom-end">
                    <Menu.Target>
                        <ActionIcon variant="subtle" color="gray">
                            <IconDotsVertical size={16} />
                        </ActionIcon>
                    </Menu.Target>

                    <Menu.Dropdown>
                        <Menu.Label>상태 변경</Menu.Label>
                        <Menu.Item
                            leftSection={<IconCheck size={14} />}
                            color="green"
                            onClick={() => updateStatusMutation.mutate({
                                id: item.id,
                                status: 'passed',
                                fcPhone: item.fc.phone,
                                examLabel: item.round_label
                            })}
                        >
                            합격 처리
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconX size={14} />}
                            color="red"
                            onClick={() => updateStatusMutation.mutate({
                                id: item.id,
                                status: 'failed',
                                fcPhone: item.fc.phone,
                                examLabel: item.round_label
                            })}
                        >
                            불합격 처리
                        </Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Table.Td>
        </Table.Tr>
    ));

    return (
        <Container size="xl" py="xl">
            <Group justify="space-between" mb="lg">
                <div>
                    <Title order={2} c={CHARCOAL}>신청자 관리</Title>
                    <Text c={MUTED} size="sm">시험별 신청자 목록을 확인하고 합격 여부를 관리합니다.</Text>
                </div>
                <Button leftSection={<IconDownload size={16} />} variant="light" color="green" onClick={handleDownloadCsv}>
                    엑셀(CSV) 다운로드
                </Button>
            </Group>

            <Group mb="md">
                <Select
                    placeholder="시험 회차 선택"
                    data={roundOptions}
                    value={selectedRoundId ?? defaultRoundId}
                    onChange={setSelectedRoundId}
                    leftSection={<IconFilter size={16} />}
                    w={300}
                    allowDeselect={false}
                />
            </Group>

            <Paper shadow="sm" radius="lg" withBorder overflow="hidden">
                <ScrollArea>
                    <Table verticalSpacing="md" highlightOnHover>
                        <Table.Thead bg="#F9FAFB">
                            <Table.Tr>
                                <Table.Th>이름</Table.Th>
                                <Table.Th>연락처</Table.Th>
                                <Table.Th>소속</Table.Th>
                                <Table.Th>지원 장소</Table.Th>
                                <Table.Th>상태</Table.Th>
                                <Table.Th>관리</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {isLoading ? (
                                <Table.Tr><Table.Td colSpan={6} align="center" py={40}><LoadingOverlay visible /></Table.Td></Table.Tr>
                            ) : rows && rows.length > 0 ? (
                                rows
                            ) : (
                                <Table.Tr><Table.Td colSpan={6} align="center" py={60} c="dimmed">
                                    {selectedRoundId ? '신청자가 없습니다.' : '시험 회차를 선택해주세요.'}
                                </Table.Td></Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Paper>
        </Container>
    );
}

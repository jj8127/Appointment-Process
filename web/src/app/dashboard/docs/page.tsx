'use client';

import {
    Badge,
    Box,
    Button,
    Container,
    Group,
    Image,
    LoadingOverlay,
    Modal,
    Paper,
    ScrollArea,
    Stack,
    Table,
    Tabs,
    Text,
    Textarea,
    ThemeIcon,
    Title
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconDownload,
    IconEye,
    IconFileText,
    IconList,
    IconRefresh,
    IconX
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { StatusToggle } from '@/components/StatusToggle';
import { supabase } from '@/lib/supabase';
import { sendPushNotification } from '../../actions';

import { logger } from '@/lib/logger';
// App Design Tokens
const HANWHA_ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const MUTED = '#6b7280';
const BACKGROUND_LIGHT = '#F9FAFB';

type DocProfile = {
    name: string | null;
    phone: string | null;
    affiliation: string | null;
};

type DocumentRow = {
    id: string;
    fc_id: string | null;
    doc_type: string;
    file_name: string | null;
    storage_path: string | null;
    status: string;
    reviewer_note: string | null;
    created_at: string;
    fc_profiles?: DocProfile | null;
};

// Status Badge Helper
const getStatusColor = (status: string) => {
    switch (status) {
        case 'approved':
            return 'green';
        case 'rejected':
            return 'red';
        case 'submitted':
        case 'pending':
            return 'blue';
        default:
            return 'gray';
    }
};

const STATUS_MAP: Record<string, string> = {
    pending: '요청중',
    submitted: '제출됨',
    approved: '승인됨',
    rejected: '반려됨',
    deleted: '삭제됨',
};

export default function DocumentsPage() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<string | null>('pending');

    // Preview Modal State
    const [previewOpened, { open: openPreview, close: closePreview }] = useDisclosure(false);
    const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null);
    const [signedUrl, setSignedUrl] = useState<string | null>(null);

    // Reject Modal State
    const [rejectOpened, { open: openReject, close: closeReject }] = useDisclosure(false);
    const [rejectReason, setRejectReason] = useState('');
    const [targetDocForReject, setTargetDocForReject] = useState<DocumentRow | null>(null);

    // Data Fetching
    const { data: documents, isLoading } = useQuery<DocumentRow[]>({
        queryKey: ['documents-list'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('fc_documents')
                .select('id, fc_id, doc_type, file_name, storage_path, status, reviewer_note, created_at, fc_profiles (name, phone, affiliation)')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data ?? []) as unknown as DocumentRow[];
        },
    });

    // Filter Logic
    const filteredDocs = useMemo(() => {
        if (!documents) return [];
        let docs = documents;

        if (activeTab === 'pending') {
            docs = docs.filter((d) => ['pending', 'submitted'].includes(d.status));
        } else if (activeTab === 'approved') {
            docs = docs.filter((d) => d.status === 'approved');
        } else if (activeTab === 'rejected') {
            docs = docs.filter((d) => d.status === 'rejected');
        }
        return docs;
    }, [documents, activeTab]);

    // --- Auto Advance Logic ---
    const checkAutoAdvance = async (fcId: string, phone: string) => {
        // Check if there are any documents for this FC that are NOT approved (and not deleted)
        const { data: pendingDocs, error } = await supabase
            .from('fc_documents')
            .select('id')
            .eq('fc_id', fcId)
            .in('status', ['pending', 'submitted', 'rejected']);

        if (error) {
            logger.error('AutoAdvance Check Error:', error);
            return;
        }

        if (pendingDocs.length === 0) {
            // All cleared! Update FC Status
            const { error: updateError } = await supabase
                .from('fc_profiles')
                .update({ status: 'docs-approved' }) // or 'docs-completed'? Dashboard uses 'docs-approved' button to transition.
                .eq('id', fcId);

            if (!updateError) {
                notifications.show({ title: '자동 승인', message: '모든 서류가 승인되어 다음 단계로 넘어갑니다.', color: 'blue' });
                // Send Push
                const title = '서류 검토 완료';
                const body = '모든 서류가 승인되었습니다. 위촉 계약 단계로 진행해주세요.';
                await supabase.from('notifications').insert({
                    title, body, target_url: '/appointment', recipient_role: 'fc', resident_id: phone
                });
                await sendPushNotification(phone, { title, body, data: { url: '/appointment' } });
            }
        }
    };

    // Mutations
    const updateStatusMutation = useMutation({
        mutationFn: async ({ doc, status, reason }: { doc: DocumentRow; status: string; reason?: string }) => {
            const reviewerNote =
                status === 'rejected' ? (reason ?? '').trim() || null : status === 'approved' ? null : undefined;
            const { error } = await supabase
                .from('fc_documents')
                .update({
                    status,
                    ...(reviewerNote !== undefined ? { reviewer_note: reviewerNote } : {}),
                })
                .eq('id', doc.id);

            if (error) throw error;

            let title = '서류 결과 안내';
            let body = `제출하신 [${doc.doc_type}] 서류가 처리되었습니다.`;

            if (status === 'approved') {
                title = '서류 승인 완료';
                body = `제출하신 [${doc.doc_type}] 서류가 승인되었습니다.`;
            } else if (status === 'rejected') {
                title = '서류 반려 안내';
                body = `제출하신 [${doc.doc_type}] 서류가 반려되었습니다.\n사유: ${reason}`;
            }

            if (status === 'rejected' && doc.fc_id) {
                await supabase.from('fc_profiles').update({ status: 'docs-pending' }).eq('id', doc.fc_id);
            }
            if (doc.fc_profiles?.phone) {
                await supabase.from('notifications').insert({
                    title,
                    body,
                    target_url: '/docs-upload',
                    recipient_role: 'fc',
                    resident_id: doc.fc_profiles.phone,
                    category: '서류',
                });
                await sendPushNotification(doc.fc_profiles.phone, { title, body, data: { url: '/docs-upload' } });
            }
            // Return doc for context
            return doc;
        },
        onSuccess: (updatedDoc) => {
            notifications.show({
                title: '처리 완료',
                message: '상태가 변경되었습니다.',
                color: 'green',
            });
            queryClient.invalidateQueries({ queryKey: ['documents-list'] });
            closeReject();
            closePreview();

            // Trigger Auto Advance Check
            if (updatedDoc?.fc_id && updatedDoc.fc_profiles?.phone) {
                checkAutoAdvance(updatedDoc.fc_id, updatedDoc.fc_profiles.phone);
            }
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
            notifications.show({
                title: '처리 실패',
                message: msg,
                color: 'red',
            });
        },
    });

    // Handlers
    const handlePreview = async (doc: DocumentRow) => {
        setSelectedDoc(doc);
        setSignedUrl(null);
        openPreview();

        if (doc.storage_path) {
            const { data, error } = await supabase.storage
                .from('fc-documents')
                .createSignedUrl(doc.storage_path, 3600);
            if (data?.signedUrl) {
                setSignedUrl(data.signedUrl);
            } else {
                logger.error('Signed URL Error:', error);
            }
        }
    };

    const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
    const [confirmConfig, setConfirmConfig] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    const showConfirm = (config: { title: string; message: string; onConfirm: () => void }) => {
        setConfirmConfig(config);
        openConfirm();
    };

    const handleConfirm = () => {
        if (confirmConfig?.onConfirm) {
            confirmConfig.onConfirm();
        }
        closeConfirm();
    };

    const handleApprove = (doc: DocumentRow) => {
        showConfirm({
            title: '서류 승인',
            message: `'${doc.doc_type}' 문서를 승인하시겠습니까?`,
            onConfirm: () => {
                updateStatusMutation.mutate({ doc, status: 'approved' });
            },
        });
    };

    const handleRejectInit = (doc: DocumentRow) => {
        setTargetDocForReject(doc);
        setRejectReason('');
        openReject();
    };

    const handleRejectConfirm = () => {
        if (!targetDocForReject) return;
        if (!rejectReason.trim()) {
            notifications.show({ title: '사유 입력', message: '반려 사유를 입력해주세요.', color: 'red' });
            return;
        }
        updateStatusMutation.mutate({
            doc: targetDocForReject,
            status: 'rejected',
            reason: rejectReason,
        });
    };

    const rows = filteredDocs.map((doc) => (
        <Table.Tr key={doc.id} style={{ transition: 'background-color 0.2s' }}>
            <Table.Td>
                <Text size="sm" c="dimmed">{dayjs(doc.created_at).format('YYYY-MM-DD HH:mm')}</Text>
            </Table.Td>
            <Table.Td>
                <Group gap="xs">
                    <ThemeIcon variant="light" color="gray" size="md" radius="xl">
                        <IconFileText size={14} />
                    </ThemeIcon>
                    <div>
                        <Text size="sm" fw={600} c={CHARCOAL}>
                            {doc.fc_profiles?.name || '알수없음'}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {doc.fc_profiles?.phone} · {doc.fc_profiles?.affiliation || '소속없음'}
                        </Text>
                    </div>
                </Group>
            </Table.Td>
            <Table.Td>
                <Badge variant="outline" color="gray" size="sm" radius="sm" style={{ textTransform: 'none' }}>
                    {doc.doc_type}
                </Badge>
            </Table.Td>
            <Table.Td>
                <Text
                    size="sm"
                    c={HANWHA_ORANGE}
                    style={{ cursor: 'pointer', fontWeight: 500 }}
                    onClick={() => handlePreview(doc)}
                >
                    {doc.file_name || '파일 확인'}
                </Text>
            </Table.Td>
            <Table.Td>
                <Badge color={getStatusColor(doc.status)} variant="light" size="sm" radius="sm">
                    {STATUS_MAP[doc.status] || doc.status}
                </Badge>
            </Table.Td>
            <Table.Td>
                <Group gap={6}>
                    <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => handlePreview(doc)}
                        leftSection={<IconEye size={12} />}
                    >
                        열기
                    </Button>
                    <StatusToggle
                        value={doc.status === 'approved' ? 'approved' : 'pending'}
                        onChange={(val) => {
                            if (val === 'approved') {
                                handleApprove(doc);
                            } else {
                                handleRejectInit(doc); // Revert to meaningful state? Or just init reject?
                                // Toggle 'Pending' usually implies Reject or Reset.
                                // User flow: Click 'Approved' -> Approved.
                                // Click 'Pending' (from Approved) -> Maybe Reset to pending?
                                // BUT logic says "If approved, modify impossible".
                                // So this onChange shouldn't even trigger if readOnly.
                                // But if it's NOT readOnly (e.g. pending/rejected), we can toggle.
                                // If I click 'Pending' while it is 'In Progress'?
                                // Actually 'Reject' needs a reason.
                                // So clicking 'Pending' side might trigger Reject Modal?
                                // Let's assume clicking 'Pending' triggers Reject flow.
                            }
                        }}
                        labelPending="미승인"
                        labelApproved="승인"
                        showNeutralForPending
                        allowPendingPress
                        readOnly={doc.status === 'approved'}
                    />
                </Group>
            </Table.Td>
        </Table.Tr>
    ));

    const isImage = (path: string | null | undefined) => {
        if (!path) return false;
        const lower = path.toLowerCase();
        return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp');
    };

    return (
        <Container size="xl" py="xl" style={{ backgroundColor: '#fff', minHeight: '100vh' }}>
            <Group justify="space-between" mb="lg" align="flex-end">
                <div>
                    <Title order={2} c={CHARCOAL}>서류 통합 관리</Title>
                    <Text c={MUTED} size="sm" mt={4}>제출된 서류를 검토하고 빠른 승인 처리를 진행하세요.</Text>
                </div>
                <Button variant="light" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => queryClient.invalidateQueries({ queryKey: ['documents-list'] })}>
                    새로고침
                </Button>
            </Group>

            <Tabs
                value={activeTab}
                onChange={setActiveTab}
                mb="xl"
                color="orange"
                variant="pills"
                radius="xl"
            >
            <Tabs.List bg={BACKGROUND_LIGHT} p={4} style={{ borderRadius: 24, border: '1px solid #e9ecef', display: 'inline-flex' }}>
                <Tabs.Tab value="pending" fw={600} px="lg" py="xs" style={{ borderRadius: 20 }}>
                        미처리 <Badge size="xs" circle ml={6} color="orange">{documents?.filter((d) => ['pending', 'submitted'].includes(d.status)).length || 0}</Badge>
                    </Tabs.Tab>
                    <Tabs.Tab value="approved" fw={600} px="lg" py="xs" style={{ borderRadius: 20 }}>승인됨</Tabs.Tab>
                    <Tabs.Tab value="rejected" fw={600} px="lg" py="xs" style={{ borderRadius: 20 }}>반려됨</Tabs.Tab>
                    <Tabs.Tab value="all" fw={600} px="lg" py="xs" style={{ borderRadius: 20 }}>전체 목록</Tabs.Tab>
                </Tabs.List>
            </Tabs>

            <Paper shadow="sm" radius="lg" withBorder style={{ overflow: 'hidden' }} pos="relative" bg="white">
                <LoadingOverlay visible={isLoading} overlayProps={{ blur: 2 }} zIndex={10} loaderProps={{ color: 'orange' }} />
                <ScrollArea h="calc(100vh - 280px)" type="auto">
                    <Table verticalSpacing="md" highlightOnHover stickyHeader>
                        <Table.Thead bg={BACKGROUND_LIGHT}>
                            <Table.Tr>
                                <Table.Th fw={600} c={CHARCOAL}>제출일시</Table.Th>
                                <Table.Th fw={600} c={CHARCOAL}>제출자 정보</Table.Th>
                                <Table.Th fw={600} c={CHARCOAL}>문서 구분</Table.Th>
                                <Table.Th fw={600} c={CHARCOAL}>첨부파일</Table.Th>
                                <Table.Th fw={600} c={CHARCOAL}>상태</Table.Th>
                                <Table.Th fw={600} c={CHARCOAL}>심사/관리</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.length > 0 ? (
                                rows
                            ) : (
                                <Table.Tr>
                                    <Table.Td colSpan={6} align="center" py={80}>
                                        <Stack align="center" gap="xs">
                                            <ThemeIcon size={60} radius="xl" color="gray.2" variant="light">
                                                <IconList size={30} color={MUTED} />
                                            </ThemeIcon>
                                            <Text c="dimmed" fw={500}>해당 조건의 서류가 존재하지 않습니다.</Text>
                                        </Stack>
                                    </Table.Td>
                                </Table.Tr>
                            )}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Paper>

            {/* Preview Modal */}
            <Modal
                opened={previewOpened}
                onClose={closePreview}
                title={<Text fw={700} size="lg">{selectedDoc?.doc_type} 검토</Text>}
                size="xl"
                radius="md"
                padding="xl"
                centered
            >
                {selectedDoc && (
                    <Stack gap="lg">
                        <Group justify="space-between" align="center">
                            <div>
                                <Text fw={700} c={CHARCOAL} size="lg">{selectedDoc.fc_profiles?.name}님 제출</Text>
                                <Text size="xs" c="dimmed">제출일: {dayjs(selectedDoc.created_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
                            </div>
                            <Badge size="lg" color={getStatusColor(selectedDoc.status)} variant="filled">
                                {STATUS_MAP[selectedDoc.status] || selectedDoc.status}
                            </Badge>
                        </Group>

                        <Box
                            style={{
                                width: '100%',
                                minHeight: 500,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                backgroundColor: '#f1f3f5',
                                borderRadius: 12,
                                border: '1px solid #dee2e6',
                                overflow: 'hidden'
                            }}
                        >
                            {signedUrl ? (
                                isImage(selectedDoc.storage_path) ? (
                                    <Image src={signedUrl} alt="Document Preview" fit="contain" mah={600} w="auto" />
                                ) : (
                                    <Stack align="center" gap="md">
                                        <ThemeIcon size={80} radius="xl" color="blue" variant="light">
                                            <IconFileText size={40} />
                                        </ThemeIcon>
                                        <Text fw={600} c={CHARCOAL}>미리보기를 지원하지 않는 형식입니다.</Text>
                                        <Text size="sm" c="dimmed">아래 버튼을 눌러 파일을 직접 확인하세요.</Text>
                                        <Button
                                            component="a"
                                            href={signedUrl}
                                            target="_blank"
                                            download={selectedDoc.file_name}
                                            leftSection={<IconDownload size={18} />}
                                            variant="filled"
                                            color="blue"
                                        >
                                            파일 열기 / 다운로드
                                        </Button>
                                    </Stack>
                                )
                            ) : (
                                <LoadingOverlay visible={true} />
                            )}
                        </Box>

                        {['pending', 'submitted'].includes(selectedDoc.status) && (
                            <Group grow mt="xs">
                                <Button
                                    color="green"
                                    size="md"
                                    radius="md"
                                    leftSection={<IconCheck size={20} />}
                                    onClick={() => handleApprove(selectedDoc)}
                                >
                                    승인 확정
                                </Button>
                                <Button
                                    color="red"
                                    variant="light"
                                    size="md"
                                    radius="md"
                                    leftSection={<IconX size={20} />}
                                    onClick={() => { closePreview(); handleRejectInit(selectedDoc); }}
                                >
                                    반려 하기
                                </Button>
                            </Group>
                        )}
                    </Stack>
                )}
            </Modal>

            {/* Reject Reason Modal */}
            <Modal
                opened={rejectOpened}
                onClose={closeReject}
                title={<Text fw={700}>반려 사유 입력</Text>}
                size="sm"
                centered
                radius="md"
            >
                <Stack>
                    <Text size="sm" c={MUTED}>
                        FC에게 전달될 구체적인 반려 사유를 입력해주세요. <br />푸시 알림으로 전송됩니다.
                    </Text>
                    <Textarea
                        placeholder="예: 글씨를 알아볼 수 없습니다. 밝은 곳에서 다시 촬영하여 제출해주세요."
                        minRows={5}
                        radius="md"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.currentTarget.value)}
                    />
                    <Group justify="flex-end" mt="sm">
                        <Button variant="default" onClick={closeReject}>취소</Button>
                        <Button color="red" onClick={handleRejectConfirm} loading={updateStatusMutation.isPending}>반려 처리</Button>
                    </Group>
                </Stack>
            </Modal>

            {/* Confirm Modal */}
            <Modal
                opened={confirmOpened}
                onClose={closeConfirm}
                title={<Text fw={700}>{confirmConfig?.title}</Text>}
                size="sm"
                centered
                radius="md"
            >
                <Stack gap="md">
                    <Text size="sm">{confirmConfig?.message}</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeConfirm}>
                            취소
                        </Button>
                        <Button color="blue" onClick={handleConfirm}>
                            확인
                        </Button>
                    </Group>
                </Stack>
            </Modal>

        </Container>
    );
}

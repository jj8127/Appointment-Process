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
    TextInput,
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
    IconSearch,
    IconX
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

import { StatusToggle } from '@/components/StatusToggle';
import { RejectReasonModal } from '@/components/RejectReasonModal';
import { useSession } from '@/hooks/use-session';
import {
    ADMIN_NOTIFICATION_WARNING_TITLE,
    getAdminNotificationWarning,
} from '@/lib/admin-notification-warning';
import { supabase } from '@/lib/supabase';

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

const NO_FILE_APPROVAL_NOTE = '총무 수동 승인: 파일 미제출';

const hasStoragePath = (value: string | null | undefined) => {
    const storagePath = String(value ?? '').trim();
    return Boolean(storagePath && storagePath !== 'deleted');
};

const isNoFileDoc = (doc: DocumentRow) => {
    return !hasStoragePath(doc.storage_path);
};

const isPendingReviewDocument = (doc: DocumentRow) =>
    ['pending', 'submitted'].includes(doc.status);

export default function DocumentsPage() {
    const queryClient = useQueryClient();
    const { isReadOnly } = useSession();
    const [activeTab, setActiveTab] = useState<string | null>('pending');
    const [searchValue, setSearchValue] = useState('');

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

    const pendingReviewCount = useMemo(
        () => (documents ?? []).filter(isPendingReviewDocument).length,
        [documents]
    );

    // Filter Logic
    const filteredDocs = useMemo(() => {
        const normalizedSearch = searchValue.trim().toLowerCase();
        let docs = documents ?? [];

        if (activeTab === 'pending') {
            docs = docs.filter(isPendingReviewDocument);
        } else if (activeTab === 'approved') {
            docs = docs.filter((d) => d.status === 'approved');
        } else if (activeTab === 'rejected') {
            docs = docs.filter((d) => d.status === 'rejected');
        }

        if (normalizedSearch) {
            docs = docs.filter((doc) => {
                const candidateName = String(doc.fc_profiles?.name ?? '').toLowerCase();
                const phone = String(doc.fc_profiles?.phone ?? '').toLowerCase();
                const affiliation = String(doc.fc_profiles?.affiliation ?? '').toLowerCase();

                return (
                    candidateName.includes(normalizedSearch)
                    || phone.includes(normalizedSearch)
                    || affiliation.includes(normalizedSearch)
                );
            });
        }

        return docs;
    }, [documents, activeTab, searchValue]);

    // Mutations
    const updateStatusMutation = useMutation({
        mutationFn: async ({ doc, status, reason }: { doc: DocumentRow; status: string; reason?: string }) => {
            const response = await fetch('/api/admin/fc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateDocStatus',
                    payload: {
                        fcId: doc.fc_id,
                        docType: doc.doc_type,
                        status,
                        reviewerNote: reason,
                    },
                }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.ok) {
                const message = result?.error ?? '상태 변경에 실패했습니다.';
                throw new Error(String(message));
            }
            return {
                doc,
                allApproved: Boolean(result?.allApproved),
                warning: getAdminNotificationWarning(result),
            };
        },
        onSuccess: (updatedDoc) => {
            notifications.show(updatedDoc.warning
                ? { title: ADMIN_NOTIFICATION_WARNING_TITLE, message: updatedDoc.warning, color: 'yellow' }
                : {
                    title: '처리 완료',
                    message: updatedDoc.allApproved
                        ? '모든 서류가 승인되어 다위촉 단계로 넘어갑니다.'
                        : '상태가 변경되었습니다.',
                    color: 'green',
                });
            queryClient.invalidateQueries({ queryKey: ['documents-list'] });
            closeReject();
            closePreview();
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

        const storagePath = String(doc.storage_path ?? '').trim();
        if (storagePath && storagePath !== 'deleted') {
            const { data, error } = await supabase.storage
                .from('fc-documents')
                .createSignedUrl(storagePath, 3600);
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
        const noFileDoc = isNoFileDoc(doc);
        const message = noFileDoc
            ? `[${doc.doc_type}] 문서는 파일이 미제출입니다. "총무 수동 승인: 파일 미제출" 사유로 승인하시겠습니까?`
            : `[${doc.doc_type}] 문서를 승인하시겠습니까?`;
        showConfirm({
            title: '서류 승인',
            message,
            onConfirm: () => {
                updateStatusMutation.mutate({
                    doc,
                    status: 'approved',
                    reason: noFileDoc ? NO_FILE_APPROVAL_NOTE : undefined,
                });
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
                    c={hasStoragePath(doc.storage_path) ? HANWHA_ORANGE : MUTED}
                    style={{ cursor: 'pointer', fontWeight: 500 }}
                    onClick={() => handlePreview(doc)}
                >
                    {hasStoragePath(doc.storage_path) ? (doc.file_name || '파일 확인') : '미제출'}
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
                            if (isReadOnly) return;
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
                        readOnly={isReadOnly || doc.status === 'approved'}
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
                    <Text c={MUTED} size="sm" mt={4}>요청 서류를 검토하고, 승인된 FC를 다위촉 단계로 넘깁니다.</Text>
                </div>
                <Button variant="light" color="gray" leftSection={<IconRefresh size={16} />} onClick={() => queryClient.invalidateQueries({ queryKey: ['documents-list'] })}>
                    새로고침
                </Button>
            </Group>

            <Paper withBorder radius="lg" p="sm" mb="lg" bg="white" shadow="xs">
                <Stack gap="sm">
                    <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                        <TextInput
                            value={searchValue}
                            onChange={(event) => setSearchValue(event.currentTarget.value)}
                            placeholder="후보자 성함 검색"
                            leftSection={<IconSearch size={14} />}
                            radius="md"
                            size="sm"
                            styles={{
                                root: { flex: '0 1 360px', minWidth: 240 },
                                input: {
                                    backgroundColor: BACKGROUND_LIGHT,
                                    borderColor: '#e5e7eb',
                                },
                            }}
                        />
                <Text size="xs" c={MUTED} fw={500}>
                            서류 {filteredDocs.length}건
                        </Text>
                    </Group>

                    <Tabs
                        value={activeTab}
                        onChange={setActiveTab}
                        color="orange"
                        variant="pills"
                        radius="xl"
                    >
                        <Tabs.List
                            style={{
                                display: 'inline-flex',
                                flexWrap: 'wrap',
                                gap: 8,
                                padding: 0,
                                backgroundColor: 'transparent',
                                border: 'none',
                            }}
                        >
                            <Tabs.Tab
                                value="pending"
                                fw={600}
                                px="md"
                                py={6}
                                style={{ borderRadius: 999, minHeight: 34 }}
                            >
                                미처리 <Badge size="xs" circle ml={6} color="orange">{pendingReviewCount}</Badge>
                            </Tabs.Tab>
                            <Tabs.Tab
                                value="approved"
                                fw={600}
                                px="md"
                                py={6}
                                style={{ borderRadius: 999, minHeight: 34 }}
                            >
                                승인됨
                            </Tabs.Tab>
                            <Tabs.Tab
                                value="rejected"
                                fw={600}
                                px="md"
                                py={6}
                                style={{ borderRadius: 999, minHeight: 34 }}
                            >
                                반려됨
                            </Tabs.Tab>
                            <Tabs.Tab
                                value="all"
                                fw={600}
                                px="md"
                                py={6}
                                style={{ borderRadius: 999, minHeight: 34 }}
                            >
                                전체 목록
                            </Tabs.Tab>
                        </Tabs.List>
                    </Tabs>
                </Stack>
            </Paper>

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
                                {isNoFileDoc(selectedDoc) ? (
                                    <Text size="xs" c="orange">
                                        파일 미제출
                                    </Text>
                                ) : null}
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
                            ) : isNoFileDoc(selectedDoc) ? (
                                <Text c="dimmed" size="lg">
                                    파일이 아직 업로드되지 않았습니다.
                                </Text>
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
                                    disabled={isReadOnly}
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
                                    disabled={isReadOnly}
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
            <RejectReasonModal
                opened={rejectOpened}
                onClose={closeReject}
                title="반려 사유 입력"
                description={<>FC에게 전달될 구체적인 반려 사유를 입력해주세요. <br />푸시 알림으로 전송됩니다.</>}
                placeholder="예: 글씨를 알아볼 수 없습니다. 밝은 곳에서 다시 촬영하여 제출해주세요."
                value={rejectReason}
                onChange={setRejectReason}
                onSubmit={handleRejectConfirm}
                submitting={updateStatusMutation.isPending}
                submitDisabled={isReadOnly}
                size="sm"
                minRows={5}
            />

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

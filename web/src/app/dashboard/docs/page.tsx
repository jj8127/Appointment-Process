'use client';

import { QueryErrorAlert } from '@/components/QueryErrorAlert';

import {
    Image,
    Loader,
    Text,
    TextInput,
    UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconDownload,
    IconFileText,
    IconRefresh,
    IconSearch,
    IconX
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { StatusToggle } from '@/components/StatusToggle';
import { ConfirmModal } from '@/components/ConfirmModal';
import { RejectReasonModal } from '@/components/RejectReasonModal';
import { useSession } from '@/hooks/use-session';
import { showAdminNotificationWarning } from '@/lib/show-admin-notification-warning';
import { ADMIN_DOCUMENT_STATUS_LABELS, fetchAdminDocuments, signAdminDocument, type AdminDocumentRow as DocumentRow } from '@/lib/admin-document-client';
import { groupDocumentsByFc, resolveReviewSelection } from '@/lib/admin-document-review';
import { ADMIN_STEP_LABELS, getAdminStepDisplay } from '@/lib/shared';
import { requireDocumentStatusReceipt } from '@/lib/user-intent-policy';
import styles from './page.module.css';

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

const isImage = (path: string | null | undefined) => {
    if (!path) return false;
    const lower = path.toLowerCase();
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp');
};

const TABS = [
    { value: 'pending', label: '미처리' },
    { value: 'approved', label: '승인됨' },
    { value: 'rejected', label: '반려됨' },
    { value: 'all', label: '전체 목록' },
] as const;

export default function DocumentsPage() {
    const queryClient = useQueryClient();
    const { isReadOnly } = useSession();
    const [activeTab, setActiveTab] = useState<string | null>('pending');
    const [searchValue, setSearchValue] = useState('');

    // Review selection: one FC on the left, one of its documents in the middle.
    const [selectedFcId, setSelectedFcId] = useState<string | null>(null);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const lastFcIndex = useRef(0);

    // Inline preview state
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewRequest = useRef(0);
    const statusSubmitting = useRef(false);

    // Reject Modal State
    const [rejectOpened, { open: openReject, close: closeReject }] = useDisclosure(false);
    const [rejectReason, setRejectReason] = useState('');
    const [targetDocForReject, setTargetDocForReject] = useState<DocumentRow | null>(null);

    // Data Fetching
    const { data: documents, isLoading, isError, error, refetch, isFetching } = useQuery<DocumentRow[]>({
        queryKey: ['documents-list'],
        queryFn: fetchAdminDocuments,
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

    const groups = useMemo(() => groupDocumentsByFc(filteredDocs), [filteredDocs]);
    const { group: selectedGroup, doc: selectedDoc } = resolveReviewSelection(groups, selectedFcId, selectedDocId, lastFcIndex.current);
    useEffect(() => {
        if (selectedGroup) lastFcIndex.current = groups.indexOf(selectedGroup);
    }, [groups, selectedGroup]);

    // Mutations
    const updateStatusMutation = useMutation({
        mutationFn: async ({
            doc,
            status,
            reason,
        }: {
            doc: DocumentRow;
            status: 'pending' | 'approved' | 'rejected';
            reason?: string;
        }) => {
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
            if (!response.ok) {
                const message = result?.error ?? '상태 변경에 실패했습니다.';
                throw new Error(String(message));
            }
            const expectedReviewerNote = status === 'rejected'
                ? String(reason ?? '').trim()
                : status === 'approved' && isNoFileDoc(doc)
                    ? NO_FILE_APPROVAL_NOTE
                    : null;
            const receipt = requireDocumentStatusReceipt(result, {
                status,
                reviewerNote: expectedReviewerNote,
            });
            showAdminNotificationWarning(result);
            return {
                doc: { ...doc, status: receipt.status, reviewer_note: receipt.reviewerNote },
                allApproved: receipt.allApproved === true,
            };
        },
        onSuccess: (updatedDoc) => {
            notifications.show({
                title: '처리 완료',
                message: updatedDoc.allApproved
                    ? '모든 서류가 승인되어 다위촉 단계로 넘어갑니다.'
                    : '상태가 변경되었습니다.',
                color: 'green',
            });
            queryClient.invalidateQueries({ queryKey: ['documents-list'] });
            closeReject();
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
            notifications.show({
                title: '처리 실패',
                message: msg,
                color: 'red',
            });
        },
        onSettled: () => { statusSubmitting.current = false; },
    });

    const submitDocumentStatus = (values: {
        doc: DocumentRow;
        status: 'pending' | 'approved' | 'rejected';
        reason?: string;
    }) => {
        if (isReadOnly || statusSubmitting.current || updateStatusMutation.isPending) return;
        statusSubmitting.current = true;
        updateStatusMutation.mutate(values);
    };

    // Preview loads inline whenever the selected document changes.
    const loadPreview = useCallback(async (doc: DocumentRow | null) => {
        const requestId = ++previewRequest.current;
        setSignedUrl(null);
        setPreviewError(null);
        if (!doc) return;
        const storagePath = String(doc.storage_path ?? '').trim();
        if (!storagePath || storagePath === 'deleted') {
            setPreviewLoading(false);
            return;
        }
        setPreviewLoading(true);
        try {
            const url = await signAdminDocument(doc.fc_id, storagePath);
            if (requestId === previewRequest.current) setSignedUrl(url);
        } catch (error) {
            if (requestId === previewRequest.current) {
                setPreviewError(error instanceof Error ? error.message : '파일을 불러오지 못했습니다.');
            }
        } finally {
            if (requestId === previewRequest.current) setPreviewLoading(false);
        }
    }, []);

    const previewKey = selectedDoc ? `${selectedDoc.id}:${selectedDoc.storage_path ?? ''}` : '';
    useEffect(() => {
        void loadPreview(selectedDoc);
        // The key covers the fields the preview depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewKey, loadPreview]);

    const selectDoc = (doc: DocumentRow) => {
        setSelectedFcId(doc.fc_id);
        setSelectedDocId(doc.id);
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
        const target = `${doc.fc_profiles?.name || '알수없음'} · [${doc.doc_type}]`;
        const message = noFileDoc
            ? `${target} 문서는 파일이 미제출입니다. "총무 수동 승인: 파일 미제출" 사유로 승인하시겠습니까?`
            : `${target} 문서를 승인하시겠습니까?`;
        showConfirm({
            title: '서류 승인',
            message,
            onConfirm: () => {
                submitDocumentStatus({
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
        submitDocumentStatus({
            doc: targetDocForReject,
            status: 'rejected',
            reason: rejectReason,
        });
    };

    const isRowPending = (doc: DocumentRow) => updateStatusMutation.isPending && updateStatusMutation.variables?.doc.id === doc.id;
    const profile = selectedGroup?.docs[0]?.fc_profiles;
    const selectedStep = selectedGroup?.docs[0]?.fc_workflow_profile ? getAdminStepDisplay(selectedGroup.docs[0].fc_workflow_profile) : null;
    const emptyText = isLoading ? '서류 목록을 불러오는 중입니다.' : isError ? '서류 목록을 확인할 수 없습니다.' : '해당 조건의 서류가 존재하지 않습니다.';

    return (
        <div className={styles.page}>
            <div className={styles.head} style={{ '--i': 0 } as CSSProperties}>
                <div>
                    <h2 className={styles.title}>서류 관리</h2>
                    <Text c="dimmed" size="sm" mt={2}>요청 서류를 검토하고, 승인된 FC를 다위촉 단계로 넘깁니다.</Text>
                </div>
                <div className={styles.headTools}>
                    <TextInput
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.currentTarget.value)}
                        placeholder="후보자 성함 검색"
                        leftSection={<IconSearch size={14} />}
                        radius="xl"
                        size="sm"
                        classNames={{ input: styles.searchInput }}
                        w={260}
                    />
                    <button type="button" className={styles.softButton} onClick={() => queryClient.invalidateQueries({ queryKey: ['documents-list'] })}>
                        <IconRefresh size={16} stroke={1.8} /> 새로고침
                    </button>
                </div>
            </div>

            <div className={styles.tabsRow} style={{ '--i': 1 } as CSSProperties}>
                <div className={styles.tabs} role="tablist" aria-label="서류 상태">
                    {TABS.map((tab) => (
                        <button
                            key={tab.value}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.value}
                            className={styles.tab}
                            onClick={() => setActiveTab(tab.value)}
                        >
                            {tab.label}
                            {tab.value === 'pending' ? <span className={styles.tabCount}>{documents ? pendingReviewCount : '—'}</span> : null}
                        </button>
                    ))}
                </div>
                <Text size="xs" c="dimmed" fw={500}>서류 {filteredDocs.length}건</Text>
            </div>

            {isError && <QueryErrorAlert error={error} onRetry={refetch} isFetching={isFetching} hasData={!!documents} subject="서류 목록" />}

            <div className={styles.review}>
                {/* Left: FCs with documents in the current tab */}
                <section className={styles.card} style={{ '--i': 2 } as CSSProperties} aria-label="제출자 목록">
                    <div className={styles.cardHead}>
                        <Text className={styles.cardTitle}>제출자</Text>
                        <span className={styles.softPill}>{groups.length}명</span>
                    </div>
                    <div className={styles.fcList}>
                        {groups.length > 0 ? groups.map((group) => {
                            const head = group.docs[0];
                            const active = group === selectedGroup;
                            return (
                                <UnstyledButton
                                    key={group.fcId}
                                    className={styles.fcRow}
                                    aria-current={active || undefined}
                                    onClick={() => { setSelectedFcId(group.fcId); setSelectedDocId(null); }}
                                >
                                    <span className={styles.avatar}>{head.fc_profiles?.name?.[0] ?? '?'}</span>
                                    <span className={styles.fcText}>
                                        <span className={styles.fcName}>
                                            {head.fc_profiles?.name || '알수없음'}
                                            {head.fc_workflow_profile ? <span className={styles.stepTag}>{getAdminStepDisplay(head.fc_workflow_profile).step}단계</span> : null}
                                        </span>
                                        <span className={styles.fcMeta}>{head.fc_profiles?.phone} · {head.fc_profiles?.affiliation || '소속없음'}</span>
                                    </span>
                                    <span className={styles.fcCount}>
                                        <span>{group.docs.length}건</span>
                                        {group.pendingCount > 0 ? <span className={styles.pendingDot}>미처리 {group.pendingCount}</span> : null}
                                    </span>
                                </UnstyledButton>
                            );
                        }) : (
                            <div className={styles.empty}>
                                <IconFileText size={26} stroke={1.5} />
                                <Text c="dimmed" size="sm" fw={500}>{emptyText}</Text>
                            </div>
                        )}
                    </div>
                </section>

                {/* Middle: inline preview of the selected document */}
                <section className={`${styles.card} ${styles.viewerCard}`} style={{ '--i': 3 } as CSSProperties} aria-label="서류 미리보기">
                    {selectedGroup && selectedDoc ? (
                        <>
                            <div className={styles.docTabs} role="tablist" aria-label={`${profile?.name ?? ''} 서류`}>
                                {selectedGroup.docs.map((doc) => (
                                    <button
                                        key={doc.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={doc.id === selectedDoc.id}
                                        className={styles.docTab}
                                        onClick={() => selectDoc(doc)}
                                    >
                                        {doc.doc_type}
                                    </button>
                                ))}
                            </div>
                            <div className={styles.viewerMeta}>
                                <span><b>{selectedDoc.doc_type}</b> 검토</span>
                                <span>{profile?.name}님 제출</span>
                                <span>제출일: {dayjs(selectedDoc.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
                                {isNoFileDoc(selectedDoc) ? <span className={styles.noFile}>파일 미제출</span> : null}
                                <span className={styles.statusPill} data-status={selectedDoc.status}>
                                    {ADMIN_DOCUMENT_STATUS_LABELS[selectedDoc.status] || selectedDoc.status}
                                </span>
                            </div>
                            <div className={styles.viewer}>
                                {signedUrl ? (
                                    isImage(selectedDoc.storage_path) ? (
                                        <Image src={signedUrl} alt={`${selectedDoc.doc_type} 미리보기`} fit="contain" mah={560} w="auto" />
                                    ) : (
                                        <div className={styles.viewerState}>
                                            <span className={styles.viewerIcon}><IconFileText size={30} stroke={1.5} /></span>
                                            <Text fw={600}>미리보기를 지원하지 않는 형식입니다.</Text>
                                            <Text size="sm" c="dimmed">아래 버튼을 눌러 파일을 직접 확인하세요.</Text>
                                        </div>
                                    )
                                ) : previewError ? (
                                    <div className={styles.viewerState}>
                                        <Text c="red">{previewError}</Text>
                                        <button type="button" className={styles.softButton} onClick={() => void loadPreview(selectedDoc)}>다시 시도</button>
                                    </div>
                                ) : isNoFileDoc(selectedDoc) ? (
                                    <Text c="dimmed" size="lg">파일이 아직 업로드되지 않았습니다.</Text>
                                ) : previewLoading ? (
                                    <Loader color="orange" />
                                ) : null}
                            </div>
                            {signedUrl ? (
                                <a className={styles.openLink} href={signedUrl} target="_blank" rel="noreferrer" download={selectedDoc.file_name ?? undefined}>
                                    <IconDownload size={16} stroke={1.8} /> 파일 열기 / 다운로드
                                </a>
                            ) : null}
                        </>
                    ) : (
                        <div className={styles.empty}>
                            {isLoading ? <Loader color="orange" /> : <IconFileText size={26} stroke={1.5} />}
                            <Text c="dimmed" size="sm" fw={500}>{emptyText}</Text>
                        </div>
                    )}
                </section>

                {/* Right: the FC's documents (every original column) and the decision */}
                <div className={styles.side}>
                    <section className={styles.card} style={{ '--i': 4 } as CSSProperties} aria-label="제출자 정보">
                        {selectedGroup ? (
                            <>
                                <div className={styles.person}>
                                    <span className={styles.avatarLarge}>{profile?.name?.[0] ?? '?'}</span>
                                    <span className={styles.fcText}>
                                        <span className={styles.personName}>{profile?.name || '알수없음'}</span>
                                        <span className={styles.fcMeta}>{profile?.phone} · {profile?.affiliation || '소속없음'}</span>
                                    </span>
                                </div>
                                {selectedStep ? (
                                    <div className={styles.stepBlock} aria-label={`현재 단계 ${selectedStep.label}`}>
                                        <div className={styles.stepHead}>
                                            <span className={styles.stepCaption}>현재 단계</span>
                                            <span className={styles.stepLabel}>{selectedStep.label}</span>
                                        </div>
                                        <div className={styles.stepBar}>
                                            {Object.values(ADMIN_STEP_LABELS).map((label, index) => (
                                                <span key={label} className={styles.stepSegment} data-state={index < selectedStep.step ? 'done' : index === selectedStep.step ? 'current' : 'todo'}>
                                                    <i />
                                                    <span>{label.replace(/^\d단계\s*/, '')}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                                <div className={styles.docTable} role="table" aria-label="이 FC의 서류">
                                    <div className={styles.docHead} role="row">
                                        <span role="columnheader">문서 구분 · 첨부파일</span>
                                        <span role="columnheader">제출일시</span>
                                        <span role="columnheader">상태</span>
                                        <span role="columnheader">심사/관리</span>
                                    </div>
                                    {selectedGroup.docs.map((doc) => (
                                        <div key={doc.id} className={styles.docRow} role="row" aria-current={doc.id === selectedDoc?.id || undefined}>
                                            <span role="cell" className={styles.docCell}>
                                                <span className={styles.docType}>{doc.doc_type}</span>
                                                <button type="button" className={styles.fileLink} title={doc.file_name ?? undefined} data-missing={!hasStoragePath(doc.storage_path) || undefined} onClick={() => selectDoc(doc)}>
                                                    {hasStoragePath(doc.storage_path) ? (doc.file_name || '파일 확인') : '미제출'}
                                                </button>
                                            </span>
                                            <span role="cell" className={styles.docDate}>{dayjs(doc.created_at).format('YYYY-MM-DD HH:mm')}</span>
                                            <span role="cell"><span className={styles.statusPill} data-status={doc.status}>{ADMIN_DOCUMENT_STATUS_LABELS[doc.status] || doc.status}</span></span>
                                            <span role="cell" className={styles.docActions}>
                                                {isRowPending(doc) ? <Text size="xs" role="status">처리 중</Text> : null}
                                                <StatusToggle
                                                    value={doc.status === 'approved' ? 'approved' : 'pending'}
                                                    onChange={(val) => {
                                                        if (isReadOnly) return;
                                                        // 승인 쪽은 승인 확인, 미승인 쪽은 반려 사유 입력으로 이어진다.
                                                        if (val === 'approved') handleApprove(doc);
                                                        else handleRejectInit(doc);
                                                    }}
                                                    labelPending="미승인"
                                                    labelApproved="승인"
                                                    showNeutralForPending
                                                    allowPendingPress
                                                    isManagerMode={isReadOnly}
                                                    readOnly={isReadOnly || doc.status === 'approved' || isRowPending(doc)}
                                                />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className={styles.empty}><Text c="dimmed" size="sm">{emptyText}</Text></div>
                        )}
                    </section>

                    {selectedDoc && isPendingReviewDocument(selectedDoc) ? (
                        <section className={styles.card} style={{ '--i': 5 } as CSSProperties} aria-label="지금 보는 서류 결정">
                            <div className={styles.cardHead}>
                                <Text className={styles.cardTitle}>{selectedDoc.doc_type}</Text>
                                <span className={styles.softPill}>지금 보는 서류</span>
                            </div>
                            <div className={styles.decision}>
                                <button type="button" className={styles.inkButton} disabled={isReadOnly || isRowPending(selectedDoc)} onClick={() => handleApprove(selectedDoc)}>
                                    <IconCheck size={18} stroke={2} /> 승인 확정
                                </button>
                                <button type="button" className={styles.softButton} disabled={isReadOnly || isRowPending(selectedDoc)} onClick={() => handleRejectInit(selectedDoc)}>
                                    <IconX size={18} stroke={2} /> 반려 하기
                                </button>
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>

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

            <ConfirmModal
                opened={confirmOpened}
                onClose={closeConfirm}
                onConfirm={handleConfirm}
                title={confirmConfig?.title}
                message={confirmConfig?.message}
            />
        </div>
    );
}

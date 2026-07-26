import { readFileSync } from 'fs';
import path from 'path';

import {
  EXAM_FLOW_CONFIGS,
  INVALID_EXAM_LOCATION_MESSAGE,
  buildExamApplyNotificationPayloads,
  buildExamRoundNotificationPayload,
  createExamApplyRealtimeChannelTopic,
  formatExamRegistrationStatus,
  formatExamSubjectSelection,
  getExamMonthKey,
  getExamApplyRestoredSelectionState,
  getExamFeeAccountCopyText,
  getExamRoundCreateFormState,
  getExamRoundEditFormState,
  getExamRoundSelectionState,
  getExamFlowConfig,
  isLocationInRound,
  isExamRegistrationVisibleInHistory,
  isExamMonthSlotConsumed,
  sendExamApplyNotificationsBestEffort,
  sortExamRoundsNewestFirst,
  validateActiveExamOwnershipFixture,
} from '../exam-flow-contract';

const repoRoot = path.resolve(__dirname, '..', '..');
const examRegistrationId = '11111111-1111-4111-8111-111111111111';
const examRoundId = '22222222-2222-4222-8222-222222222222';

const readAppSource = (fileName: string) =>
  readFileSync(path.join(repoRoot, 'app', fileName), 'utf8');

const baseRound = {
  id: 'round-1',
  exam_date: '2026-07-20',
  registration_deadline: '2026-07-10',
  round_label: '1차',
  notes: 'memo',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  locations: [
    {
      id: 'loc-1',
      round_id: 'round-1',
      location_name: '서울',
      sort_order: 1,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
    {
      id: 'loc-2',
      round_id: 'round-1',
      location_name: '부산',
      sort_order: 2,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
  ],
};

describe('exam round list ordering', () => {
  it('sorts the newest exam date first with deterministic tie breakers', () => {
    const older = { ...baseRound, id: 'older', exam_date: '2026-07-20' };
    const newerEarlierDeadline = {
      ...baseRound,
      id: 'newer-earlier-deadline',
      exam_date: '2026-08-20',
      registration_deadline: '2026-08-01',
    };
    const newerLaterDeadline = {
      ...baseRound,
      id: 'newer-later-deadline',
      exam_date: '2026-08-20',
      registration_deadline: '2026-08-05',
    };

    expect(sortExamRoundsNewestFirst([older, newerEarlierDeadline, newerLaterDeadline]))
      .toEqual([newerLaterDeadline, newerEarlierDeadline, older]);
  });
});

describe('exam apply realtime channel topics', () => {
  it('creates opaque unique topics for rapid effect reconnects', () => {
    const first = createExamApplyRealtimeChannelTopic('exam-apply-life');
    const second = createExamApplyRealtimeChannelTopic('exam-apply-life');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^exam-apply-life-[a-z0-9]+-[a-z0-9]+$/);
    expect(first).not.toContain('resident');
  });
});

describe('exam flow contract', () => {
  it('keeps one calendar-month slot across life, nonlife, and third subjects', () => {
    expect(getExamMonthKey('2026-08-31')).toBe('2026-08');
    expect(getExamMonthKey('invalid')).toBeNull();
    expect(isExamMonthSlotConsumed('applied')).toBe(true);
    expect(isExamMonthSlotConsumed('confirmed')).toBe(true);
    expect(isExamMonthSlotConsumed('completed')).toBe(true);
    expect(isExamMonthSlotConsumed('no_show')).toBe(true);
    expect(isExamMonthSlotConsumed('rejected')).toBe(false);
    expect(isExamMonthSlotConsumed('cancelled_by_fc')).toBe(false);
    expect(isExamMonthSlotConsumed('cancelled_by_admin')).toBe(false);
  });

  it('hides cancelled applications from FC history but retains rejection history', () => {
    expect(isExamRegistrationVisibleInHistory('applied')).toBe(true);
    expect(isExamRegistrationVisibleInHistory('confirmed')).toBe(true);
    expect(isExamRegistrationVisibleInHistory('completed')).toBe(true);
    expect(isExamRegistrationVisibleInHistory('no_show')).toBe(true);
    expect(isExamRegistrationVisibleInHistory('rejected')).toBe(true);
    expect(isExamRegistrationVisibleInHistory('cancelled_by_fc')).toBe(false);
    expect(isExamRegistrationVisibleInHistory('cancelled_by_admin')).toBe(false);
  });

  it('fails closed when an active registration is not owned by the exact FC identity', () => {
    const profiles = [{ id: 'fc-1', phone: '010-1234-5678' }];

    expect(validateActiveExamOwnershipFixture([
      {
        id: 'registration-without-fc',
        fc_id: null,
        resident_id: '01012345678',
        status: 'applied',
      },
    ], profiles)).toEqual({
      ok: false,
      registrationId: 'registration-without-fc',
      reason: 'missing_fc',
    });

    expect(validateActiveExamOwnershipFixture([
      {
        id: 'registration-owned-by-other-fc',
        fc_id: 'fc-1',
        resident_id: '01099999999',
        status: 'confirmed',
      },
    ], profiles)).toEqual({
      ok: false,
      registrationId: 'registration-owned-by-other-fc',
      reason: 'identity_mismatch',
    });

    expect(validateActiveExamOwnershipFixture([
      {
        id: 'valid-active-registration',
        fc_id: 'fc-1',
        resident_id: '01012345678',
        status: 'completed',
      },
      {
        id: 'inactive-legacy-registration',
        fc_id: null,
        resident_id: '01099999999',
        status: 'rejected',
      },
    ], profiles)).toEqual({ ok: true });
  });

  it('round-trips primary-only, third-only, and combined subject labels', () => {
    expect(formatExamSubjectSelection({
      examType: 'nonlife',
      includesPrimaryExam: true,
      isThirdExam: false,
    })).toBe('손해');
    expect(formatExamSubjectSelection({
      examType: 'nonlife',
      includesPrimaryExam: false,
      isThirdExam: true,
    })).toBe('제3');
    expect(formatExamSubjectSelection({
      examType: 'life',
      includesPrimaryExam: true,
      isThirdExam: true,
    })).toBe('생명, 제3');
    expect(formatExamRegistrationStatus('rejected')).toBe('반려');
  });
  it('keeps life and nonlife flow differences in config', () => {
    expect(Object.keys(EXAM_FLOW_CONFIGS)).toEqual(['life', 'nonlife']);

    expect(getExamFlowConfig('life')).toMatchObject({
      examType: 'life',
      applyRoute: '/exam-apply',
      manageRoute: '/exam-manage',
      applyRoundsQueryKey: ['exam-rounds-for-apply', 'life'],
      myApplyQueryKeyPrefix: 'my-exam-apply-life',
      registerRoundsQueryKey: ['exam-rounds-life'],
      applyRealtimeChannelPrefix: 'exam-apply-life',
      registerRoundChannel: 'exam-register-life-rounds',
      registerLocationChannel: 'exam-register-life-locations',
      feeAccount: {
        label: '응시료 납입 계좌',
        value: '신한 110-505-328638 김태훈',
      },
    });

    expect(getExamFlowConfig('nonlife')).toMatchObject({
      examType: 'nonlife',
      applyRoute: '/exam-apply2',
      manageRoute: '/exam-manage2',
      applyRoundsQueryKey: ['exam-rounds-for-apply', 'nonlife'],
      myApplyQueryKeyPrefix: 'my-exam-apply-nonlife',
      registerRoundsQueryKey: ['exam-rounds-nonlife'],
      applyRealtimeChannelPrefix: 'exam-apply-nonlife',
      registerRoundChannel: 'exam-register-nonlife-rounds',
      registerLocationChannel: 'exam-register-nonlife-locations',
      feeAccount: {
        label: '응시료 납입 계좌',
        value: '신한 110-444-751201 김태훈',
      },
    });
  });

  it('keeps the invalid round-location message in one shared contract', () => {
    expect(INVALID_EXAM_LOCATION_MESSAGE).toBe(
      '선택한 응시 지역이 해당 시험 회차에 속하지 않습니다. 응시 지역을 다시 선택해주세요.',
    );
  });

  it('builds fee account copy text from the selected flow config', () => {
    expect(getExamFeeAccountCopyText('life')).toEqual({
      label: '응시료 납입 계좌',
      value: '신한 110-505-328638 김태훈',
      copyLabel: '복사',
      accessibilityLabel: '응시료 납입 계좌 복사',
      accessibilityHint: '응시료 납입 계좌 정보를 클립보드에 복사합니다.',
    });

    expect(getExamFeeAccountCopyText('nonlife')).toMatchObject({
      label: '응시료 납입 계좌',
      value: '신한 110-444-751201 김태훈',
    });
  });

  it('centralizes round and location selection state transitions', () => {
    expect(isLocationInRound(baseRound, 'loc-2')).toBe(true);
    expect(isLocationInRound(baseRound, 'missing')).toBe(false);
    expect(isLocationInRound(null, 'loc-1')).toBe(false);

    expect(getExamRoundSelectionState(baseRound)).toEqual({
      selectedRoundId: 'round-1',
      selectedLocationId: null,
    });

    const restored = getExamApplyRestoredSelectionState({
      existingForRound: {
        location_id: 'loc-2',
        is_third_exam: true,
        fee_paid_date: '2026-07-09T00:00:00.000Z',
      },
      selectedRound: baseRound,
    });
    expect(restored.selectedLocationId).toBe('loc-2');
    expect(restored.wantsPrimary).toBe(true);
    expect(restored.wantsThird).toBe(true);
    expect(restored.feePaidDate?.toISOString()).toBe('2026-07-09T00:00:00.000Z');
    expect(restored.tempFeePaidDate?.toISOString()).toBe('2026-07-09T00:00:00.000Z');

    expect(
      getExamApplyRestoredSelectionState({
        existingForRound: {
          location_id: 'loc-1',
          includes_primary_exam: true,
          is_third_exam: false,
        },
        selectedRound: baseRound,
      }),
    ).toMatchObject({ wantsPrimary: true, wantsThird: false });

    expect(
      getExamApplyRestoredSelectionState({
        existingForRound: {
          location_id: 'loc-1',
          includes_primary_exam: false,
          is_third_exam: true,
        },
        selectedRound: baseRound,
      }),
    ).toMatchObject({ wantsPrimary: false, wantsThird: true });

    expect(
      getExamApplyRestoredSelectionState({
        existingForRound: {
          location_id: 'loc-1',
          includes_primary_exam: true,
          is_third_exam: true,
        },
        selectedRound: baseRound,
      }),
    ).toMatchObject({ wantsPrimary: true, wantsThird: true });

    expect(
      getExamApplyRestoredSelectionState({
        existingForRound: {
          location_id: 'other-round-location',
          is_third_exam: null,
          fee_paid_date: null,
        },
        selectedRound: baseRound,
      }),
    ).toEqual({
      selectedLocationId: null,
      wantsPrimary: true,
      wantsThird: false,
      feePaidDate: null,
      tempFeePaidDate: null,
    });

    expect(
      getExamApplyRestoredSelectionState({
        existingForRound: null,
        selectedRound: baseRound,
      }),
    ).toEqual({
      selectedLocationId: null,
      wantsPrimary: true,
      wantsThird: false,
      feePaidDate: null,
      tempFeePaidDate: null,
    });
  });

  it('centralizes admin round create and edit form transitions', () => {
    const now = new Date('2026-07-04T01:02:03.000Z');
    const createState = getExamRoundCreateFormState(now);

    expect(createState).toEqual({
      selectedRoundId: null,
      roundForm: { roundLabel: '', notes: '' },
      examDate: now,
      deadlineDate: now,
      locationInput: '',
      locationOrder: '0',
      draftLocations: [],
    });

    expect(getExamRoundEditFormState(baseRound, now)).toEqual({
      selectedRoundId: 'round-1',
      roundForm: { roundLabel: '1차', notes: 'memo' },
      examDate: new Date('2026-07-20'),
      deadlineDate: new Date('2026-07-10'),
      locationInput: '',
      locationOrder: '0',
      draftLocations: [],
    });

    expect(
      getExamRoundEditFormState(
        { ...baseRound, exam_date: null, registration_deadline: '' },
        now,
      ),
    ).toMatchObject({
      selectedRoundId: 'round-1',
      roundForm: { roundLabel: '1차', notes: 'memo' },
      examDate: now,
      deadlineDate: now,
    });
  });

  it('builds apply notification payloads without changing route or category contracts', () => {
    expect(
      buildExamApplyNotificationPayloads({
        examType: 'life',
        examRegistrationId,
        actor: '홍길동',
        residentId: 'resident-1',
        examTitle: '2026-07-20 (1차)',
        locationName: '서울',
      }),
    ).toEqual({
      admin: {
        type: 'notify',
        target_role: 'admin',
        target_id: null,
        title: '홍길동님이 2026-07-20 (1차)을 신청하였습니다.',
        body: '홍길동님이 2026-07-20 (1차) (서울)을 신청하였습니다.',
        category: 'exam_apply',
        url: '/exam-manage',
        target: {
          version: 1,
          kind: 'exam',
          examType: 'life',
          examRegistrationId,
        },
      },
      fcSelf: {
        type: 'notify',
        target_role: 'fc',
        target_id: 'resident-1',
        title: '시험 신청이 접수되었습니다.',
        body: '2026-07-20 (1차) (서울) 접수가 완료되었습니다.',
        category: 'exam_apply',
        url: '/exam-apply',
        target: {
          version: 1,
          kind: 'exam',
          examType: 'life',
          examRegistrationId,
        },
      },
    });

    expect(
      buildExamApplyNotificationPayloads({
        examType: 'nonlife',
        examRegistrationId,
        actor: '홍길동',
        residentId: 'resident-1',
        examTitle: '2026-07-20 (1차)',
        locationName: '',
      }).admin,
    ).toMatchObject({
      title: '홍길동님이 2026-07-20 (1차)을 신청하였습니다.',
      body: '홍길동님이 2026-07-20 (1차)을 신청하였습니다.',
      url: '/exam-manage2',
    });
  });

  it('builds round notification payloads from the selected apply route', () => {
    expect(
      buildExamRoundNotificationPayload({
        examType: 'nonlife',
        examRoundId,
        title: '일정이 등록되었습니다.',
        body: '응시를 희망하는 경우 신청해주세요.',
      }),
    ).toEqual({
      type: 'notify',
      target_role: 'fc',
      target_id: null,
      title: '일정이 등록되었습니다.',
      body: '응시를 희망하는 경우 신청해주세요.',
      category: 'exam_round',
      url: '/exam-apply2',
      target: {
        version: 1,
        kind: 'exam',
        examType: 'nonlife',
        examRoundId,
      },
    });
  });

  it('keeps post-commit notification failures from reclassifying a saved application as failed', async () => {
    const payloads = buildExamApplyNotificationPayloads({
      examType: 'life',
      examRegistrationId,
      actor: 'FC user',
      residentId: 'resident-1',
      examTitle: '2026-07-20',
      locationName: 'Seoul',
    });
    const notify = jest
      .fn<Promise<void>, [typeof payloads.admin]>()
      .mockRejectedValueOnce(new Error('notification unavailable'))
      .mockResolvedValueOnce();

    await expect(
      sendExamApplyNotificationsBestEffort(payloads, notify),
    ).resolves.toEqual({
      failedTargets: ['admin'],
      invalidTargets: [],
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, payloads.admin);
    expect(notify).toHaveBeenNthCalledWith(2, payloads.fcSelf);
  });

  it('keeps owned screens wired to the common exam flow contract', () => {
    const expectations = [
      {
        file: 'exam-apply.tsx',
        required: [
          "from '@/lib/exam-flow-contract'",
          "const examFlowType = 'life' as const;",
          'buildExamApplyNotificationPayloads',
          'createExamApplyRealtimeChannelTopic',
          'getExamApplyRestoredSelectionState',
          'getExamFeeAccountCopyText',
          'getExamRoundSelectionState',
        ],
      },
      {
        file: 'exam-apply2.tsx',
        required: [
          "from '@/lib/exam-flow-contract'",
          "const examFlowType = 'nonlife' as const;",
          'buildExamApplyNotificationPayloads',
          'createExamApplyRealtimeChannelTopic',
          'getExamApplyRestoredSelectionState',
          'getExamFeeAccountCopyText',
          'getExamRoundSelectionState',
        ],
      },
      {
        file: 'exam-register.tsx',
        required: [
          "from '@/lib/exam-flow-contract'",
          "const examFlowType = 'life' as const;",
          'buildExamRoundNotificationPayload',
          'getExamRoundCreateFormState',
          'getExamRoundEditFormState',
          'sortExamRoundsNewestFirst',
        ],
      },
      {
        file: 'exam-register2.tsx',
        required: [
          "from '@/lib/exam-flow-contract'",
          "const examFlowType = 'nonlife' as const;",
          'buildExamRoundNotificationPayload',
          'getExamRoundCreateFormState',
          'getExamRoundEditFormState',
          'sortExamRoundsNewestFirst',
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = readAppSource(expectation.file);
      for (const required of expectation.required) {
        expect(source).toContain(required);
      }

      if (expectation.file === 'exam-register.tsx' || expectation.file === 'exam-register2.tsx') {
        expect(source).toContain('KeyboardAvoidingView');
        expect(source).toContain('scrollResponderScrollNativeHandleToKeyboard');
        expect(source).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
        expect(source).toContain('variant="accent"');
        expect(source).toContain('disabled={!canAddLocation}');
        expect(source).not.toContain('KeyboardAwareWrapper');
      }

      if (expectation.file === 'exam-apply.tsx' || expectation.file === 'exam-apply2.tsx') {
        expect(source).toContain('sendExamApplyNotificationsBestEffort');
        expect(source).toContain('const hasAvailableRounds = allRounds.some');
        expect(source).toContain('!hasAvailableRounds');
        expect(source).toContain('현재 신청 가능한 시험이 없습니다.');
        expect(source).toContain(
          '.channel(createExamApplyRealtimeChannelTopic(examFlowConfig.applyRealtimeChannelPrefix))',
        );
        expect(source).not.toContain('${examFlowConfig.applyRealtimeChannelPrefix}-${residentId}');
        expect(source).not.toMatch(
          /await notifyExamFlow\(notificationPayloads\.(admin|fcSelf)\)/,
        );
      }

      expect(source).not.toMatch(/const (LIFE|NONLIFE)_EXAM_FEE_ACCOUNT/);
      expect(source).not.toMatch(/const INVALID_LOCATION_MESSAGE/);
      expect(source).not.toMatch(/function isLocationInRound/);
      expect(source).not.toMatch(/async function notify(Admin|FcSelf|AllFcs)/);
      expect(source).not.toMatch(/\.eq\('exam_type',\s*'(life|nonlife)'\)/);
      expect(source).not.toMatch(/exam_type:\s*'(life|nonlife)' as const/);
    }
  });
});

import { readFileSync } from 'fs';
import path from 'path';

import {
  EXAM_FLOW_CONFIGS,
  INVALID_EXAM_LOCATION_MESSAGE,
  buildExamApplyNotificationPayloads,
  buildExamRoundNotificationPayload,
  getExamApplyRestoredSelectionState,
  getExamFeeAccountCopyText,
  getExamRoundCreateFormState,
  getExamRoundEditFormState,
  getExamRoundSelectionState,
  getExamFlowConfig,
  isLocationInRound,
  sendExamApplyNotificationsBestEffort,
} from '../exam-flow-contract';

const repoRoot = path.resolve(__dirname, '..', '..');

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

describe('exam flow contract', () => {
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
    expect(restored.wantsThird).toBe(true);
    expect(restored.feePaidDate?.toISOString()).toBe('2026-07-09T00:00:00.000Z');
    expect(restored.tempFeePaidDate?.toISOString()).toBe('2026-07-09T00:00:00.000Z');

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
        actor: '홍길동',
        residentId: 'resident-1',
        examTitle: '2026-07-20 (1차)',
        locationName: '서울',
      }),
    ).toEqual({
      admin: {
        type: 'notify',
        target_role: 'admin',
        target_id: 'resident-1',
        title: '홍길동님이 2026-07-20 (1차)을 신청하였습니다.',
        body: '홍길동님이 2026-07-20 (1차) (서울)을 신청하였습니다.',
        category: 'exam_apply',
        url: '/exam-manage',
      },
      fcSelf: {
        type: 'notify',
        target_role: 'fc',
        target_id: 'resident-1',
        title: '시험 신청이 접수되었습니다.',
        body: '2026-07-20 (1차) (서울) 접수가 완료되었습니다.',
        category: 'exam_apply',
        url: '/exam-apply',
      },
    });

    expect(
      buildExamApplyNotificationPayloads({
        examType: 'nonlife',
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
    });
  });

  it('keeps post-commit notification failures from reclassifying a saved application as failed', async () => {
    const payloads = buildExamApplyNotificationPayloads({
      examType: 'life',
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
    ).resolves.toEqual({ failedTargets: ['admin'] });
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
        ],
      },
    ];

    for (const expectation of expectations) {
      const source = readAppSource(expectation.file);
      for (const required of expectation.required) {
        expect(source).toContain(required);
      }

      if (expectation.file === 'exam-apply.tsx' || expectation.file === 'exam-apply2.tsx') {
        expect(source).toContain('sendExamApplyNotificationsBestEffort');
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

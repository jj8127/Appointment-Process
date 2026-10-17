import {
  getAssignmentManager,
  getAssignmentProgress,
  summarizeRequestProgress,
} from '@/lib/request-board-progress';

const manager = { company_name: '교보생명', users: { name: '가상 매니저' } };

describe('request board progress', () => {
  it('walks an FC request through the four steps and marks whose turn it is', () => {
    expect(getAssignmentProgress({ status: 'pending' }, 'fc')).toMatchObject({ label: '수락 대기', step: 0, isMyTurn: false, turnLabel: '매니저 처리 중' });
    expect(getAssignmentProgress({ status: 'accepted' }, 'fc')).toMatchObject({ label: '설계 중', step: 1, isMyTurn: false });
    expect(getAssignmentProgress({ status: 'completed', fc_decision: null }, 'fc')).toMatchObject({ label: '검토 대기', step: 2, isMyTurn: true, turnLabel: '내 차례' });
    expect(getAssignmentProgress({ status: 'completed', fc_decision: 'accepted' }, 'fc')).toMatchObject({ label: '승인 완료', step: 3, ended: true, tone: 'done' });
  });

  it('never shows a manager rejection as done', () => {
    const rejected = getAssignmentProgress({ status: 'rejected' }, 'fc');
    expect(rejected).toMatchObject({ label: '매니저 거절', tone: 'stopped', ended: true, turnLabel: '다시 요청 필요' });
    expect(rejected.label).not.toContain('완료');
  });

  it('flips the turn for the manager viewing the same assignment', () => {
    expect(getAssignmentProgress({ status: 'pending' }, 'designer')).toMatchObject({ isMyTurn: true, turnLabel: '내 차례' });
    expect(getAssignmentProgress({ status: 'completed', fc_decision: 'pending' }, 'designer')).toMatchObject({ isMyTurn: false, turnLabel: 'FC 검토 중' });
  });

  it('leads the card with the assignment that needs the viewer and names its manager', () => {
    const summary = summarizeRequestProgress([
      { status: 'rejected', designers: { company_name: 'DB손보', users: { name: '다른 매니저' } } },
      { status: 'completed', fc_decision: null, designers: manager },
    ], 'fc');
    expect(summary).toMatchObject({ label: '검토 대기', isMyTurn: true, manager: '가상 매니저 · 교보생명', others: 1 });
    expect(summarizeRequestProgress([], 'fc')).toBeNull();
    expect(getAssignmentManager({ designers: null })).toBeNull();
  });
});

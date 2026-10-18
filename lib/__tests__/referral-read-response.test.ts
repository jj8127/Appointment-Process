import {
  parseMyReferralCodeResponse,
  parseMyInviteesResponse,
  parseReferralGraphResponse,
  parseReferralTreeResponse,
  parseSignupReferralSearchResponse,
} from '@/lib/referral-read-response';

const treePayload = () => ({
  ok: true,
  root: {
    fcId: 'root',
    name: '루트',
    affiliation: '',
    code: 'ROOT01',
    directInviteeCount: 1,
    totalDescendantCount: 2,
  },
  ancestors: [],
  descendants: [
    {
      fcId: 'child',
      parentFcId: 'root',
      name: '자녀',
      affiliation: null,
      code: null,
      directInviteeCount: 1,
      totalDescendantCount: 1,
      depth: 1,
      relationshipSource: 'linked',
    },
    {
      fcId: 'grandchild',
      parentFcId: 'child',
      name: null,
      affiliation: null,
      code: null,
      directInviteeCount: 0,
      totalDescendantCount: 0,
      depth: 2,
      relationshipSource: 'linked',
    },
  ],
  depth: 2,
  truncated: false,
});

const graphNode = (id: string, isViewer = false) => ({
  id,
  name: id,
  affiliation: '테스트',
  activeCode: null,
  nodeStatus: 'missing_code',
  signupCompleted: false,
  allCommissionsCompleted: false,
  directInviteeCount: isViewer ? 1 : 0,
  totalDescendantCount: isViewer ? 1 : 0,
  isViewer,
});

describe('referral read response contracts', () => {
  it('accepts complete referral code and search responses', () => {
    expect(parseMyReferralCodeResponse({
      ok: true,
      code: 'ABC123',
      codeId: 'code-id',
      createdAt: '2026-10-13T00:00:00.000Z',
      recommender: null,
      recommenderAffiliation: null,
      recommenderCode: null,
    })).toEqual({
      code: 'ABC123',
      recommender: null,
      recommenderAffiliation: null,
      recommenderCode: null,
    });

    expect(parseSignupReferralSearchResponse({
      ok: true,
      results: [{ fcId: 'fc-1', name: '추천인', affiliation: '', code: 'ABC123' }],
    })).toHaveLength(1);
  });

  it('rejects omitted or malformed referral code and search fields', () => {
    expect(() => parseMyReferralCodeResponse({ ok: true, code: 'ABC123' })).toThrow(
      '추천 조회 응답',
    );
    expect(() => parseSignupReferralSearchResponse({ ok: true })).toThrow('추천 조회 응답');
    expect(() => parseSignupReferralSearchResponse({
      ok: true,
      results: [{ fcId: 'fc-1', name: '추천인', affiliation: '', code: '' }],
    })).toThrow('추천 조회 응답');
  });

  it('requires a complete, unique invitee list instead of treating malformed success as empty', () => {
    const invitee = {
      id: '11111111-1111-4111-8111-111111111111',
      inviteeName: '초대자',
      inviteePhone: '010-****-2222',
      status: 'confirmed',
      capturedAt: '2026-10-13T00:00:00.000Z',
      confirmedAt: '2026-10-13T00:00:00.000Z',
    };
    expect(parseMyInviteesResponse({ ok: true, invitees: [invitee] })).toEqual([invitee]);
    expect(() => parseMyInviteesResponse({ ok: true })).toThrow('추천 조회 응답');
    expect(() => parseMyInviteesResponse({ ok: true, invitees: [{ ...invitee, capturedAt: '' }] }))
      .toThrow('추천 조회 응답');
    expect(() => parseMyInviteesResponse({ ok: true, invitees: [invitee, invitee] }))
      .toThrow('추천 조회 응답');
  });

  it('requires a complete, depth-consistent referral tree', () => {
    expect(parseReferralTreeResponse(treePayload(), { depth: 2, rootFcId: 'root' }))
      .toMatchObject({ depth: 2, truncated: false });

    const missingDescendants = treePayload() as Record<string, unknown>;
    delete missingDescendants.descendants;
    expect(() => parseReferralTreeResponse(missingDescendants, { depth: 2 }))
      .toThrow('추천 조회 응답');

    const invalidParentDepth = treePayload();
    invalidParentDepth.descendants[1].parentFcId = 'root';
    expect(() => parseReferralTreeResponse(invalidParentDepth, { depth: 2 }))
      .toThrow('추천 조회 응답');

    const partialSuccess = treePayload();
    partialSuccess.descendants = partialSuccess.descendants.slice(0, 1);
    expect(() => parseReferralTreeResponse(partialSuccess, { depth: 2 }))
      .toThrow('추천 조회 응답');
  });

  it('requires one connected graph rooted at the viewer', () => {
    const valid = {
      ok: true,
      mode: 'graph',
      nodes: [graphNode('root', true), graphNode('child')],
      edges: [{ id: 'root->child', source: 'root', target: 'child' }],
      permissions: { canMutate: false, scope: 'downline', rootFcId: 'root' },
      truncated: false,
    };
    expect(parseReferralGraphResponse(valid)).toBe(valid);

    expect(() => parseReferralGraphResponse({ ...valid, edges: [] }))
      .toThrow('추천 조회 응답');
    expect(() => parseReferralGraphResponse({
      ...valid,
      nodes: [...valid.nodes, graphNode('orphan')],
      edges: [
        ...valid.edges,
        { id: 'orphan->child', source: 'orphan', target: 'child' },
      ],
    })).toThrow('추천 조회 응답');
  });
});

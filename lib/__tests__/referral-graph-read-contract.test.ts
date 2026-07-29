import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'supabase/functions/get-referral-tree/index.ts'),
  'utf8',
);

const graphResolver = source.slice(
  source.indexOf('async function resolveReferralGraph'),
  source.indexOf('async function resolveReferralTree'),
);
const graphChildLoader = source.slice(
  source.indexOf('async function fetchGraphChildEdges'),
  source.indexOf('function collectReachableDescendants'),
);

describe('referral graph read contract', () => {
  it('keeps graph mode additive to the legacy tree response', () => {
    expect(source).toContain("if (mode === 'graph')");
    expect(source).toContain('return resolveReferralGraph(sessionResult.session)');
    expect(source).toContain('return resolveReferralTree(req, sessionResult.session)');
  });

  it('limits native graph access to signed FC and manager sessions', () => {
    expect(graphResolver).toContain("session.role !== 'fc' && session.role !== 'manager'");
    expect(graphResolver).toContain('const rootFcId = resolved.profile?.id');
    expect(graphResolver).toContain('allowManagerShadowBootstrap: false');
    expect(graphResolver).not.toContain('body.fcId');
    expect(graphResolver).not.toContain('requestedFcId');
  });

  it('returns a downline-only read contract without phone data', () => {
    expect(graphResolver).toContain("mode: 'graph'");
    expect(graphResolver).toContain('canMutate: false');
    expect(graphResolver).toContain("scope: 'downline'");
    expect(graphResolver).toContain('rootFcId');
    expect(graphResolver).not.toContain('phone:');
  });

  it('bounds and paginates graph reads without exposing raw database failures', () => {
    expect(source).toContain('const MOBILE_GRAPH_MAX_NODES = 300');
    expect(source).toContain('.range(offset, offset + QUERY_PAGE_SIZE - 1)');
    expect(graphResolver).toContain('maxDescendants: MOBILE_GRAPH_MAX_NODES - 1');
    expect(graphResolver).toContain('includeManagerReferralShadows: true');
    expect(graphResolver).toContain('fetchGraphChildEdges(');
    expect(graphChildLoader).toContain('while (edgeMap.size < safeLimit)');
    expect(graphChildLoader).toContain('const pageSize = QUERY_PAGE_SIZE');
    expect(graphChildLoader).toContain('.range(offset, offset + pageSize - 1)');
    expect(graphChildLoader).toContain('isGraphEligibleProfile(profile, excludedStaffPhones)');
    expect(graphChildLoader).not.toContain('profile.is_manager_referral_shadow === true');
    expect(source).toContain(
      'traversalTruncated = traversalTruncated || overflowEdges.length > 0',
    );
    expect(graphResolver).toContain("return fail('db_error', '추천 관계 그래프를 불러오지 못했습니다.', 500)");
    expect(graphResolver).not.toContain('error.message');
  });
});

import { parseReferralAllowanceResponse } from '../referral-allowance-response';
import { fictionalAllowanceResponse, fictionalReferralGraph, REFERRAL_FICTIONAL_DATA } from '../referral-dev-fictional';

describe('dev-only fictional referral data', () => {
  it('is off unless explicitly enabled in a dev build', () => {
    expect(REFERRAL_FICTIONAL_DATA).toBe(false);
  });

  it('passes the real allowance response validator for every month', () => {
    const access = parseReferralAllowanceResponse(fictionalAllowanceResponse('access'), 'access');
    expect(access.enabled).toBe(true);
    for (const month of ['2026-06', '2026-07', '2026-08']) {
      const parsed = parseReferralAllowanceResponse(fictionalAllowanceResponse('statement', month), 'statement', month);
      expect(parsed.statement?.nodes.length).toBeGreaterThan(50);
      expect(parsed.statement?.nodes.every((node) => node.name.startsWith('가상'))).toBe(true);
    }
  });

  it('builds a connected downline graph rooted at the viewer', () => {
    const graph = fictionalReferralGraph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.nodes.filter((node) => node.isViewer)).toHaveLength(1);
    expect(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(graph.edges).toHaveLength(graph.nodes.length - 1);
  });
});

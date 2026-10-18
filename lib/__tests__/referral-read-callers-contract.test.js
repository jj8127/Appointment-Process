/* global describe, it, expect */
const { readFileSync } = require('node:fs');

const read = (path) => readFileSync(path, 'utf8');

describe('referral read response callers', () => {
  it('validates every active mobile referral success envelope before normalization', () => {
    const myCode = read('hooks/use-my-referral-code.ts');
    const tree = read('hooks/use-referral-tree.ts');
    const graph = read('hooks/use-referral-graph.ts');
    const signup = read('app/signup.tsx');

    expect(myCode).toContain('parseMyReferralCodeResponse(data)');
    expect(myCode).not.toContain('code: typeof data.code');
    expect(tree).toContain('parseReferralTreeResponse(data');
    expect(tree).not.toContain('descendants: Array.isArray(data.descendants)');
    expect(graph.indexOf('parseReferralGraphResponse(data)'))
      .toBeLessThan(graph.indexOf('normalizeReferralGraph(parsed.nodes'));
    expect(signup).toContain('parseSignupReferralSearchResponse(data)');
    expect(signup).not.toContain('Array.isArray(data?.results) ? data.results : []');
  });
});

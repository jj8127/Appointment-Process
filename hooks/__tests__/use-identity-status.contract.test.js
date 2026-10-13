/* global describe, it, expect */
const fs = require('node:fs');
const path = require('node:path');

describe('identity status read contract', () => {
  it('requires one complete FC profile instead of synthesizing an unregistered state', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'hooks', 'use-identity-status.ts'),
      'utf8',
    );

    expect(source).toContain('.maybeSingle()');
    expect(source).toContain('requireSupabaseRowMatching(');
    expect(source).toContain("'identity_status_profile'");
    expect(source).not.toContain('data?.[0]');
    expect(source).not.toContain('row?.id ?? null');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('password login attempt boundary', () => {
  it('uses one database-owned compare/count/reset receipt for all account kinds', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'login-with-password', 'index.ts'),
      'utf8',
    );
    expect(source).toContain("supabase.rpc('process_password_login_attempt_v1'");
    expect(source).toContain("accountKind: 'admin'");
    expect(source).toContain("accountKind: 'manager'");
    expect(source).toContain("accountKind: 'fc'");
    expect(source).not.toContain(".update({ failed_count: 0, locked_until: null })");
    expect(source).not.toContain('const nextCount =');
    expect(source).toContain('mutationRowReceiptMatches(data, {');
  });
});

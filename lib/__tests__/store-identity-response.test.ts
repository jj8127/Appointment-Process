import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requireStoreIdentityReceipt } from '@/lib/store-identity-error';

const root = join(__dirname, '..', '..');

describe('store identity response contract', () => {
  it('accepts only a completed receipt bound to the requested resident id', () => {
    const receipt = {
      ok: true as const,
      residentId: '01012345678',
      identityCompleted: true as const,
    };
    expect(requireStoreIdentityReceipt(receipt, '010-1234-5678')).toEqual(receipt);
    expect(() => requireStoreIdentityReceipt(null, '01012345678')).toThrow();
    expect(() => requireStoreIdentityReceipt({ ...receipt, ok: false }, '01012345678')).toThrow();
    expect(() => requireStoreIdentityReceipt({ ...receipt, residentId: '01099999999' }, '01012345678')).toThrow();
    expect(() => requireStoreIdentityReceipt({ ...receipt, identityCompleted: false }, '01012345678')).toThrow();
  });

  it('requires the atomic identity RPC receipt before reporting completion', () => {
    const edgeSource = readFileSync(
      join(root, 'supabase', 'functions', 'store-identity', 'index.ts'),
      'utf8',
    );
    const identitySource = readFileSync(join(root, 'app', 'identity.tsx'), 'utf8');

    expect(edgeSource).toContain("from '../_shared/ux-mutation-contract.ts'");
    expect(edgeSource).toContain("from '../_shared/request-board-auth.ts'");
    expect(edgeSource).toContain("req.headers.get('x-app-session-token')");
    expect(edgeSource).toContain('await requireAppSessionFromRequest(req)');
    expect(edgeSource).toContain("sessionResult.session.role !== 'fc'");
    expect(edgeSource).toContain(".eq('id', sessionFcId)");
    expect(edgeSource).toContain(".eq('phone', residentId)");
    expect(edgeSource).toContain('residentId !== sessionPhone');
    expect(edgeSource).toContain("supabase.rpc('store_fc_identity_atomic_v1'");
    expect(edgeSource).toContain('mutationRowReceiptMatches(receipt, expectedReceipt)');
    expect(edgeSource).not.toContain(".from('fc_identity_secure')\n      .upsert");
    expect(edgeSource).not.toContain(".from('fc_profiles')\n      .update");
    expect(identitySource).toContain('invokeStoreIdentity(payload)');
    expect(identitySource).toContain('requireStoreIdentityReceipt(data, residentId)');
  });
});

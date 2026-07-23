import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const functionSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'functions', 'exam-payment-proof', 'index.ts'),
  'utf8',
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    'supabase',
    'migrations',
    '20260723040446_add_exam_payment_proofs.sql',
  ),
  'utf8',
);

test('payment proof Edge function requires signed app session and service-side save', () => {
  assert.match(functionSource, /requireAppSessionFromRequest/);
  assert.match(functionSource, /session\.role !== 'fc' && session\.role !== 'manager'/);
  assert.match(functionSource, /submit_exam_registration_with_payment_proof/);
  assert.doesNotMatch(functionSource, /getPublicUrl/);
});

test('payment proof schema is private and service-role only', () => {
  assert.match(migrationSource, /'exam-payment-proofs'[\s\S]*false/);
  assert.match(migrationSource, /to service_role/);
  assert.match(
    migrationSource,
    /revoke all on table public\.exam_payment_proof_uploads from public, anon, authenticated/,
  );
  assert.match(migrationSource, /security invoker/);
  assert.match(
    migrationSource,
    /revoke all on function public\.submit_exam_registration_with_payment_proof/,
  );
});

test('legacy rows remain compatible while new server submissions require proof', () => {
  assert.match(
    migrationSource,
    /payment_proof_policy_version smallint not null default 0/,
  );
  assert.match(
    migrationSource,
    /payment_proof_policy_version = 0 or payment_proof_attached/,
  );
  assert.match(
    migrationSource,
    /payment_proof_policy_version[\s\S]*1/,
  );
});

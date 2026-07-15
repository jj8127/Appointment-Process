import fs from 'node:fs';
import path from 'node:path';

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('exam round atomic save contract', () => {
  const actionSource = readRepoFile('web/src/app/dashboard/exam/schedule/actions.ts');
  const migrationSource = readRepoFile(
    'supabase/migrations/20260712000002_atomic_exam_round_save.sql',
  );
  const schemaSource = readRepoFile('supabase/schema.sql');

  it('uses one service-role RPC instead of a partial multi-statement save', () => {
    const saveStart = actionSource.indexOf('export async function saveExamRoundAction');
    const fetchStart = actionSource.indexOf('export async function fetchExamRoundsAction');
    const saveSource = actionSource.slice(saveStart, fetchStart);

    expect(saveSource).toContain(".rpc(\n            'save_exam_round_atomic'");
    expect(saveSource).not.toContain(".from('exam_rounds')");
    expect(saveSource).not.toContain(".from('exam_locations')");
    expect(saveSource.indexOf('parseExamRoundSaveInput(payload)')).toBeLessThan(
      saveSource.indexOf("'save_exam_round_atomic'"),
    );
  });

  it('keeps round and location mutations in one database function', () => {
    expect(migrationSource).toContain('create or replace function public.save_exam_round_atomic(');
    expect(migrationSource).toContain('insert into public.exam_rounds');
    expect(migrationSource).toContain('update public.exam_rounds');
    expect(migrationSource).toContain('insert into public.exam_locations');
    expect(migrationSource).toContain('update public.exam_locations');
    expect(migrationSource).toContain('delete from public.exam_locations');
    expect(migrationSource).toContain('from public.exam_registrations registration');
    expect(migrationSource).toContain("auth.role() is distinct from 'service_role'");
    expect(migrationSource).toContain('p_registration_deadline > p_exam_date');
  });

  it('exposes the RPC only to service_role and keeps schema snapshot in parity', () => {
    const signature =
      'public.save_exam_round_atomic(uuid, date, date, text, text, text, text[])';
    expect(migrationSource).toContain(`revoke all on function ${signature}`);
    expect(migrationSource).toContain(`grant execute on function ${signature}`);
    expect(migrationSource).toContain('to service_role;');
    expect(schemaSource).toContain('create or replace function public.save_exam_round_atomic(');
    expect(schemaSource).toContain(`revoke all on function ${signature}`);
    expect(schemaSource).toContain(`grant execute on function ${signature}`);
  });
});

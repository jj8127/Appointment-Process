import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('user presence phone ambiguity migration', () => {
  const foundation = read(
    'supabase/migrations/20260311000003_create_user_presence.sql',
  );
  const repair = read(
    'supabase/migrations/20260809050929_fix_user_presence_phone_ambiguity.sql',
  );
  const schema = read('supabase/schema.sql');

  it('uses an explicit conflict constraint and qualified stale-row predicate', () => {
    for (const source of [foundation, schema]) {
      expect(source).toContain(
        'on conflict on constraint user_presence_pkey do update',
      );
      expect(source).toContain(
        'from public.user_presence as presence\n     where presence.phone = normalized_phone',
      );
      expect(source).not.toContain('on conflict (phone) do update');
    }
  });

  it('patches only the exact deployed function signatures and fails closed on drift', () => {
    expect(repair).toContain("'public.touch_user_presence(text,text)'::regprocedure");
    expect(repair).toContain(
      "'public.stale_user_presence(text,text,timestamp with time zone)'::regprocedure",
    );
    expect(repair).toContain('touch_user_presence_phone_source_drift');
    expect(repair).toContain('stale_user_presence_phone_source_drift');
    expect(repair).toContain('execute v_patched_definition');
  });
});

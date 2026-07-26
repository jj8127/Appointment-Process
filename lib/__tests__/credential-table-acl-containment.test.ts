import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260724151737_contain_privileged_account_table_acl.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const helperMigration = readFileSync(
  path.join(
    root,
    'supabase',
    'migrations',
    '20260726131500_secure_rls_profile_identity_helpers.sql',
  ),
  'utf8',
);
const schema = readFileSync(
  path.join(root, 'supabase', 'schema.sql'),
  'utf8',
);
const normalizedMigration = migration.replace(/\s+/g, ' ').trim().toLowerCase();
const normalizedHelperMigration = helperMigration
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const normalizedSchema = schema.replace(/\s+/g, ' ').trim().toLowerCase();

type DataApiRole = 'public' | 'anon' | 'authenticated' | 'service_role';
type TableName =
  | 'profiles'
  | 'fc_credentials'
  | 'admin_accounts'
  | 'manager_accounts';
type Operation = 'select' | 'insert' | 'update' | 'delete';

const protectedTables: TableName[] = [
  'profiles',
  'fc_credentials',
  'admin_accounts',
  'manager_accounts',
];
const credentialTables: TableName[] = [
  'fc_credentials',
  'admin_accounts',
  'manager_accounts',
];
const operations: Operation[] = ['select', 'insert', 'update', 'delete'];

function hasTableGrant(
  sql: string,
  role: DataApiRole,
  table: TableName,
  operation: Operation,
) {
  const grants = [
    ...sql.matchAll(
      /grant ([a-z,\s]+?) on table public\.([a-z_]+) to ([a-z_]+);/g,
    ),
  ];

  return grants.some(([, privilegeList, grantedTable, grantedRole]) => {
    const privileges = privilegeList
      .split(',')
      .map((privilege) => privilege.trim());
    return (
      grantedTable === table
      && grantedRole === role
      && privileges.includes(operation)
    );
  });
}

function canUseDataApi({
  role,
  table,
  operation,
  actorId,
  rowId,
}: {
  role: DataApiRole;
  table: TableName;
  operation: Operation;
  actorId?: string;
  rowId?: string;
}) {
  if (!hasTableGrant(normalizedMigration, role, table, operation)) {
    return false;
  }

  if (role === 'service_role') {
    return true;
  }

  if (
    role === 'authenticated'
    && table === 'profiles'
    && operation === 'select'
  ) {
    const ownRowPolicy =
      normalizedMigration.includes('create policy "profiles own row select"')
      && normalizedMigration.includes('to authenticated')
      && normalizedMigration.includes('and id = (select auth.uid())');
    return ownRowPolicy && Boolean(actorId) && actorId === rowId;
  }

  return false;
}

describe('privileged account table ACL containment', () => {
  it.each(protectedTables)(
    'revokes PUBLIC, anon, and authenticated table and column privileges on %s',
    (table) => {
      const tableRevoke =
        `revoke all privileges on table public.${table} `
        + 'from public, anon, authenticated;';
      expect(normalizedMigration).toContain(tableRevoke);
      expect(normalizedSchema).toContain(tableRevoke);
    },
  );

  it('keeps service-role DML explicit and grants authenticated only profile SELECT', () => {
    for (const table of protectedTables) {
      for (const operation of operations) {
        expect(
          hasTableGrant(
            normalizedMigration,
            'service_role',
            table,
            operation,
          ),
        ).toBe(true);
        expect(
          hasTableGrant(
            normalizedSchema,
            'service_role',
            table,
            operation,
          ),
        ).toBe(true);
      }
    }

    expect(
      hasTableGrant(
        normalizedMigration,
        'authenticated',
        'profiles',
        'select',
      ),
    ).toBe(true);
    expect(
      hasTableGrant(
        normalizedSchema,
        'authenticated',
        'profiles',
        'select',
      ),
    ).toBe(true);
    for (const operation of ['insert', 'update', 'delete'] as const) {
      expect(
        hasTableGrant(
          normalizedMigration,
          'authenticated',
          'profiles',
          operation,
        ),
      ).toBe(false);
    }
  });

  it('allows an authenticated user to select only its own profile row', () => {
    expect(
      canUseDataApi({
        role: 'authenticated',
        table: 'profiles',
        operation: 'select',
        actorId: 'user-a',
        rowId: 'user-a',
      }),
    ).toBe(true);
    expect(
      canUseDataApi({
        role: 'authenticated',
        table: 'profiles',
        operation: 'select',
        actorId: 'user-a',
        rowId: 'user-b',
      }),
    ).toBe(false);
    expect(
      canUseDataApi({
        role: 'anon',
        table: 'profiles',
        operation: 'select',
        rowId: 'user-a',
      }),
    ).toBe(false);
  });

  it.each([
    ['self-promotion', 'role'],
    ['FC reassignment', 'fc_id'],
    ['identity reassignment', 'id'],
  ])('rejects authenticated %s through direct profile UPDATE (%s)', () => {
    expect(
      canUseDataApi({
        role: 'authenticated',
        table: 'profiles',
        operation: 'update',
        actorId: 'user-a',
        rowId: 'user-a',
      }),
    ).toBe(false);
  });

  it.each(credentialTables)(
    'rejects every direct client CRUD operation on %s',
    (table) => {
      for (const role of ['public', 'anon', 'authenticated'] as const) {
        for (const operation of operations) {
          expect(canUseDataApi({ role, table, operation })).toBe(false);
        }
      }
    },
  );

  it('removes all historical policies and retains only the own-profile read policy', () => {
    expect(normalizedMigration).toContain('from pg_policies');
    expect(normalizedMigration).toContain(
      "'profiles', 'fc_credentials', 'admin_accounts', 'manager_accounts'",
    );
    expect(normalizedMigration).toContain(
      'create policy "profiles own row select"',
    );
    expect(normalizedMigration).not.toContain(
      'create policy "profiles update"',
    );
    expect(normalizedMigration).not.toMatch(
      /create policy "[^"]+" on public\.(fc_credentials|admin_accounts|manager_accounts)/,
    );
  });

  it('keeps schema and migration security statements in parity', () => {
    const requiredStatements = [
      'create policy "profiles own row select"',
      'create or replace function public.enforce_profiles_trusted_write()',
      'before insert or update or delete on public.profiles',
      "if current_user in ('anon', 'authenticated')",
      'grant select on table public.profiles to authenticated;',
    ];

    for (const statement of requiredStatements) {
      expect(normalizedMigration).toContain(statement);
      expect(normalizedSchema).toContain(statement);
    }
  });

  it('keeps profile-backed RLS identity helpers executable without restoring table access', () => {
    for (const helper of ['is_admin', 'is_manager', 'is_fc', 'current_fc_id']) {
      for (const source of [normalizedHelperMigration, normalizedSchema]) {
        expect(source).toContain(
          `create or replace function public.${helper}()`,
        );
        expect(source).toMatch(
          new RegExp(
            `create or replace function public\\.${helper}\\(\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog, public`,
          ),
        );
        expect(source).toContain(
          `revoke all on function public.${helper}() from public;`,
        );
        expect(source).toContain(
          `grant execute on function public.${helper}() to anon, authenticated, service_role;`,
        );
      }
    }
    expect(normalizedHelperMigration).not.toContain(
      'grant select on table public.profiles to anon',
    );
  });
});

describe('trusted account lifecycle call sites', () => {
  const serviceRoleFunctions = [
    'login-with-password',
    'request-signup-otp',
    'set-password',
    'request-password-reset',
    'reset-password',
    'sync-request-board-session',
  ];

  it.each(serviceRoleFunctions)(
    '%s initializes its database client with the service-role secret',
    (functionName) => {
      const source = readFileSync(
        path.join(
          root,
          'supabase',
          'functions',
          functionName,
          'index.ts',
        ),
        'utf8',
      );
      expect(source).toContain("getEnv('SUPABASE_SERVICE_ROLE_KEY')");
      expect(source).toContain('createClient(supabaseUrl, serviceKey)');
    },
  );

  it('keeps the initial auth profile bootstrap on the trusted auth trigger', () => {
    expect(normalizedSchema).toContain(
      'create or replace function public.handle_new_auth_user() returns trigger',
    );
    expect(normalizedSchema).toContain('security definer');
    expect(normalizedSchema).toContain(
      'after insert on auth.users for each row execute function public.handle_new_auth_user();',
    );
  });
});

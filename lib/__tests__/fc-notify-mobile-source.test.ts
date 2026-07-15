import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const wrapperPath = join(root, 'lib', 'fc-notify-client.ts');

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return collectSourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('fc-notify mobile source ownership', () => {
  it('keeps every app/lib Edge invocation behind the authenticated wrapper', () => {
    const directInvokePattern = /functions\s*\.\s*invoke(?:\s*<[^;]*?>)?\s*\(\s*['"]fc-notify['"]/m;
    const directEndpointPattern = /functions\/v1\/fc-notify/;
    const offenders = [
      ...collectSourceFiles(join(root, 'app')),
      ...collectSourceFiles(join(root, 'lib')),
    ]
      .filter((path) => path !== wrapperPath)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return directInvokePattern.test(source) || directEndpointPattern.test(source);
      });

    expect(offenders).toEqual([]);
  });

  it('keeps the wrapper on the anon Supabase client while adding a separate session header', () => {
    const source = readFileSync(wrapperPath, 'utf8');

    expect(source).toContain("import { supabase } from './supabase'");
    expect(source).toContain("'x-app-session-token'");
    expect(source).toContain('supabase.functions.invoke<TResponse>');
    expect(source).not.toContain('functions.setAuth');
    expect(source).not.toContain('Authorization:');
  });
});

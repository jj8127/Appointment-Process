import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('agent room build tracing contract', () => {
  it('keeps workspace scanning out of Turbopack static tracing', () => {
    const source = readRepoFile('web/src/lib/agent-room-server.ts');
    const nextConfig = readRepoFile('web/next.config.ts');

    expect(source).toContain('/*turbopackIgnore: true*/ process.cwd()');
    expect(nextConfig).toContain("'/api/agent-room'");
    expect(nextConfig).toContain("outputFileTracingExcludes");
    expect(nextConfig).toContain("root: path.resolve(__dirname, '..')");
  });
});

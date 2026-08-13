import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'admin-action', 'index.ts'),
  'utf8',
);

describe('admin-action FC self-profile contract', () => {
  it('authorizes the two profile actions only from the signed FC actor', () => {
    expect(source).toContain(
      "const allowFcSelfProfile = action === 'getOwnProfile' || action === 'updateOwnProfile';",
    );
    expect(source).toContain('allowFcSelfProfile && requesterFcIds.length > 0');
    expect(source).toContain("trustedRole === 'fc'");
    expect(source).toContain('const ownFcId = requesterFcIds[0];');
  });

  it('derives the target profile server-side and whitelists mutable fields', () => {
    const getStart = source.indexOf("if (action === 'getOwnProfile')");
    const updateStart = source.indexOf("if (action === 'updateOwnProfile')");
    const updateEnd = source.indexOf("if (action === 'getResidentNumbers')", updateStart);
    const getAction = source.slice(getStart, updateStart);
    const updateAction = source.slice(updateStart, updateEnd);

    expect(getAction).toContain(".eq('id', ownFcId)");
    expect(getAction).toContain(".in('phone', buildResidentIds(trustedPhone))");
    expect(updateAction).toContain('normalizeFcBasicInformationPatch(payload.patch)');
    expect(updateAction).toContain(".eq('id', ownFcId)");
    expect(updateAction).not.toContain('payload.fcId');
    expect(updateAction).not.toContain('phone:');
    expect(updateAction).not.toContain('recommender');
    expect(updateAction).not.toContain('status');
  });
});

import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

describe('mobile FC basic-information source contract', () => {
  const source = read('app/fc/new.tsx');

  it('loads and updates through signed FC-self admin-action operations', () => {
    expect(source).toContain("'getOwnProfile'");
    expect(source).toContain("'updateOwnProfile'");
    expect(source).toContain('invokeAdminAction');
    expect(source).not.toContain("supabase.from('fc_profiles').update(basePayload)");
    expect(source).not.toContain(".from('fc_profiles')\n        .insert(insertPayload)");
  });

  it('does not expose an editable blank form while canonical profile loading failed', () => {
    expect(source).toContain("useState<'loading' | 'ready' | 'error'>('loading')");
    expect(source).toContain("profileLoadState !== 'ready'");
    expect(source).toContain('retryBasicInformationLoad');
  });

  it('keeps the login phone immutable and removes profile payload diagnostics', () => {
    const phoneFieldStart = source.indexOf('name="phone"');
    const phoneField = source.slice(phoneFieldStart, phoneFieldStart + 420);

    expect(phoneField).toContain('editable={false}');
    expect(source).not.toContain("logger.debug('[fc/new] loadExisting: DB data', { data })");
    expect(source).not.toContain("logger.debug('[fc/new] loadExisting: signup raw', { raw })");
    expect(source).not.toContain("logger.debug('[DEBUG] Mobile: Creating FC Profile Payload'");
  });

  it('keeps focused fields visible above the Android keyboard', () => {
    expect(source).not.toContain('<ScrollView');
    expect(source).toContain('<KeyboardAwareWrapper');
    expect(source).toContain("extraScrollHeight={Platform.OS === 'android' ? 220 : 140}");
    expect(source).toContain('keyboardDismissMode="none"');
    expect(source).not.toContain('keyboardDismissMode="on-drag"');
    expect(source).toContain('setTimeout(() => scrollToInput(node), 220)');
  });
});

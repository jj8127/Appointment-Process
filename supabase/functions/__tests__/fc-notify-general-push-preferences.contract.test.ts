import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'fc-notify', 'index.ts'),
  'utf8',
);
const policy = readFileSync(
  join(
    process.cwd(),
    'supabase',
    'functions',
    '_shared',
    'general-push-preference-policy.ts',
  ),
  'utf8',
);
const deviceTokens = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'device-token-register', 'index.ts'),
  'utf8',
);
const preferences = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'notification-preferences', 'index.ts'),
  'utf8',
);

describe('fc-notify general Expo preference enforcement', () => {
  it('maps Request Board messages separately from request lifecycle activity', () => {
    expect(policy).toContain("if (category === 'request_board_message') return 'messages'");
    expect(policy).toContain("startsWith(REQUEST_BOARD_CATEGORY_PREFIX)) return 'request_activity'");
    expect(policy).toContain("return 'operations'");
  });

  it('filters generic and lifecycle Expo paths only after inbox persistence is confirmed', () => {
    const genericInsert = source.indexOf('const logResult = skipNotificationInsert');
    const genericFilter = source.indexOf(
      'const generalPushPreferenceResult = await applyGeneralPushPreferences(tokens, category)',
    );
    const genericExpo = source.indexOf('const pushPayload = tokens.map', genericFilter);
    expect(genericInsert).toBeGreaterThan(-1);
    expect(genericFilter).toBeGreaterThan(genericInsert);
    expect(genericExpo).toBeGreaterThan(genericFilter);

    const lifecyclePersistence = source.indexOf('if (notificationPersistenceFailed)');
    const lifecycleFilter = source.indexOf(
      'const lifecyclePreferenceResult = await applyGeneralPushPreferences',
    );
    const lifecycleExpo = source.indexOf('const payload = tokens.map', lifecycleFilter);
    expect(lifecycleFilter).toBeGreaterThan(lifecyclePersistence);
    expect(lifecycleExpo).toBeGreaterThan(lifecycleFilter);
  });

  it('resolves preference actors by exact token role and fails lookup closed', () => {
    expect(source).toContain("queryStaffActors('admin_accounts', residentIdsByRole.admin)");
    expect(source).toContain("queryStaffActors('manager_accounts', residentIdsByRole.manager)");
    expect(source).toContain('queryFcActors(residentIdsByRole.manager)');
    expect(source).toContain('queryFcActors(residentIdsByRole.fc)');
    expect(source).toContain("buildGeneralPushActorKey(role, residentId)");
    expect(source).toContain('GENERAL_PUSH_PREFERENCE_QUERY_CHUNK_SIZE = 100');
    expect(source).toContain('chunkSupabaseFilterValues(');
    expect(source).toContain('collectSupabaseRows<GeneralPushActorRow>({');
    expect(source).toContain('collectSupabaseRows<GeneralPushFcActorRow>({');
    expect(source).toContain(".in('phone', phoneChunk)");
    expect(source).toContain(".order('id', { ascending: true })");
    expect(source).toContain('.range(from, to)');
    expect(source).toContain('const globalRows = preferenceResults.flatMap');
    expect(source).toContain('const categoryRows = preferenceResults.flatMap');
    const generalStart = source.indexOf('async function loadGeneralPushPreferenceEligibility');
    const generalEnd = source.indexOf('async function applyGeneralPushPreferences', generalStart);
    const generalSource = source.slice(generalStart, generalEnd);
    expect(generalSource).toContain('globalRows,');
    expect(generalSource).toContain('categoryRows,');
    expect(generalSource).not.toContain('globalRows: globalResult.data ?? []');
    expect(source).toContain('return { eligibleTokens: [], lookupFailed: true }');
    expect(source).toMatch(
      /async function applyGeneralPushPreferences[\s\S]*?catch \{[\s\S]*?eligibleTokens: \[\], lookupFailed: true/,
    );
    expect(source).toContain(".from('app_push_preferences')");
    expect(source).toContain(".from('app_push_category_preferences')");
  });

  it('rejects null, non-array, and malformed preference query successes', () => {
    expect(source).toContain('isAppPushPreferenceRow as isGlobalPreferenceRow');
    expect(source).toContain('isAppPushCategoryPreferenceRow as isCategoryPreferenceRow');
    expect(source).toContain('isMessengerRoomPreferenceRow as isRoomPreferenceRow');
    expect(source).not.toContain('function isGlobalPreferenceRow(');
    expect(source).not.toContain('function isCategoryPreferenceRow(');
    expect(source).not.toContain('function isRoomPreferenceRow(');
    const directStart = source.indexOf('async function applyDirectMessageNotificationPreferences');
    const directEnd = source.indexOf('function buildGeneralPushActorKey', directStart);
    const directSource = source.slice(directStart, directEnd);
    expect(directSource).toContain('parseQueryRows(globalResult.data, isGlobalPreferenceRow)');
    expect(directSource).toContain('parseQueryRows(categoryResult.data, isCategoryPreferenceRow)');
    expect(directSource).toContain('parseQueryRows(roomResult.data, isRoomPreferenceRow)');
    expect(directSource).toContain('!hasUniquePreferenceActors(globalRows)');
    expect(directSource).not.toContain('globalResult.data ?? []');
    expect(directSource).not.toContain('categoryResult.data ?? []');
    expect(directSource).not.toContain('roomResult.data ?? []');

    const generalStart = source.indexOf('async function loadGeneralPushPreferenceEligibility');
    const generalEnd = source.indexOf('async function applyGeneralPushPreferences', generalStart);
    const generalSource = source.slice(generalStart, generalEnd);
    expect(generalSource).toContain('const preferenceLookupInvalid = preferenceResults.some');
    expect(generalSource).toContain('isRow: isGeneralPushStaffActorRow');
    expect(generalSource).toContain('isRow: isGeneralPushFcActorRow');
    expect(generalSource).toContain('!phoneSet.has(sanitize(row.phone))');
    expect(generalSource).toContain('seenIds.has(row.id)');
    expect(generalSource).toContain('parseQueryRows(globalResult.data, isGlobalPreferenceRow)');
    expect(generalSource).toContain('parseQueryRows(categoryResult.data, isCategoryPreferenceRow)');
    expect(generalSource).not.toContain('globalResult.data ?? []');
    expect(generalSource).not.toContain('categoryResult.data ?? []');
    expect(generalSource).not.toContain(".in('phone', Array.from(residentIds))");
  });

  it('resolves manager-role designer tokens to their canonical FC preference actor', () => {
    expect(deviceTokens).toContain("role: designerCompany ? 'manager' as DeviceTokenRole : 'fc' as DeviceTokenRole");
    expect(preferences).toContain("role: isDesigner ? 'manager' : 'fc'");
    expect(preferences).toContain('id: data.id');
    expect(source).toContain(".select('id,phone,affiliation,signup_completed,is_manager_referral_shadow')");
    expect(source).toContain('parseDesignerCompanyNameFromAffiliation(row.affiliation)');
    expect(source).toMatch(
      /addActors\(\s*'manager',[\s\S]*?designerFcRows[\s\S]*?is_manager_referral_shadow !== true/,
    );
    expect(source).toContain('selectSingleCanonicalPreferenceActor(candidates)');
  });

  it('keeps administrator Web Push retired', () => {
    expect(source).toContain("reason: 'in-app-only'");
    expect(source).not.toContain('web-push/send');
  });
});

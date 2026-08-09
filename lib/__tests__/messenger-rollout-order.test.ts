import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'deployment', 'messenger-v2-rollout-manifest.template.json'),
  'utf8',
)) as {
  release_decision: string;
  canonical_phase_order: string[];
  phases: {
    id: string;
    migration_order?: string[];
    messenger_migration_order?: string[];
    function_allowlist?: string[];
    bulk_deploy_allowed?: boolean;
    completed: boolean;
  }[];
  transitional_compatibility: {
    counts_as_phase_completion: boolean;
    remove_missing_rpc_fallbacks_before_all_database_smoke: boolean;
  };
  mobile_release: { after_phase: string; decision: string };
};

describe('Messenger V2 cross-repository rollout order', () => {
  test('pins the only allowed infrastructure phase order and records infrastructure completion', () => {
    expect(manifest.canonical_phase_order).toEqual([
      'garamin_db',
      'garamlink_db',
      'garamlink_server',
      'garamin_edge',
    ]);
    expect(manifest.phases.map((phase) => phase.id)).toEqual(manifest.canonical_phase_order);
    expect(manifest.phases.every((phase) => phase.completed === true)).toBe(true);
    expect(manifest.release_decision).toBe('GO');
    expect(manifest.mobile_release).toEqual({ after_phase: 'garamin_edge', decision: 'HOLD' });
  });

  test('keeps every GaramIn database migration present and timestamp ordered', () => {
    const phase = manifest.phases.find((candidate) => candidate.id === 'garamin_db');
    expect(phase?.migration_order).toEqual([
      '20260804093425_messenger_search_indexes.sql',
      '20260804093738_add_app_push_and_messenger_room_preferences.sql',
      '20260804113409_atomic_direct_room_mute_notifications.sql',
      '20260808094709_canonicalize_request_board_personal_recipients_v1.sql',
      '20260808131459_personal_admin_direct_threads_v1.sql',
      '20260808141824_messenger_room_hub_actions_v1.sql',
      '20260808144212_internal_messenger_summary_v1.sql',
      '20260808151912_atomic_messenger_room_preference_patch_v1.sql',
    ]);
    phase?.migration_order?.forEach((file) => {
      expect(fs.existsSync(path.join(repositoryRoot, 'supabase', 'migrations', file))).toBe(true);
    });
  });

  test('requires GaramLink room actions before server and explicit Edge function deploys', () => {
    const databasePhase = manifest.phases.find((candidate) => candidate.id === 'garamlink_db');
    const edgePhase = manifest.phases.find((candidate) => candidate.id === 'garamin_edge');
    expect(databasePhase?.messenger_migration_order).toEqual([
      '20260804092715_messenger_search_indexes.sql',
      '20260808141847_messenger_room_notification_preferences.sql',
      '20260808141859_messenger_room_hub_actions_v1.sql',
      '20260808142722_messenger_notification_receipt_atomicity.sql',
      '20260808144307_messenger_conversation_summary_pages_v1.sql',
      '20260808152337_atomic_messenger_room_preference_patch_v1.sql',
      '20260809135239_fix_messenger_attachment_special_forms.sql',
    ]);
    expect(edgePhase?.function_allowlist).toEqual([
      'fc-notify',
      'group-chat',
      'messenger-attachments',
      'notification-preferences',
    ]);
    expect(edgePhase?.bulk_deploy_allowed).toBe(false);
    edgePhase?.function_allowlist?.forEach((functionName) => {
      expect(fs.existsSync(path.join(repositoryRoot, 'supabase', 'functions', functionName))).toBe(true);
    });
  });

  test('does not treat the compatibility Edge baseline as rollout completion', () => {
    expect(manifest.transitional_compatibility.counts_as_phase_completion).toBe(false);
    expect(
      manifest.transitional_compatibility
        .remove_missing_rpc_fallbacks_before_all_database_smoke,
    ).toBe(false);
  });
});

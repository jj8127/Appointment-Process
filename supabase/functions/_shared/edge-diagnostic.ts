export type EdgeDiagnosticErrorClass =
  | 'network'
  | 'timeout'
  | 'upstream'
  | 'database'
  | 'authentication';

type EdgeDiagnosticPair =
  | {
      event: 'set_password.referral_resolution';
      reason:
        | 'not_found_or_inactive'
        | 'inviter_hint_mismatch'
        | 'code_lookup_failed'
        | 'inviter_profile_lookup_failed'
        | 'unexpected_error';
    }
  | {
      event: 'set_password.referral_event';
      reason: 'insert_failed';
    }
  | {
      event: 'set_password.referral_link';
      reason: 'apply_failed';
    }
  | {
      event: 'login_with_password.referral_bootstrap';
      reason:
        | 'referral_code_auto_issue_failed'
        | 'manager_shadow_ensure_failed'
        | 'manager_shadow_lookup_failed';
    }
  | {
      event: 'request_board.password_sync';
      reason: 'upstream_rejected' | 'invalid_response' | 'request_failed' | 'timeout';
    }
  | {
      event: 'fc_notify.admin_web_push';
      reason: 'upstream_rejected' | 'request_failed';
    }
  | {
      event: 'fc_notify.expo_push';
      reason: 'request_failed' | 'timeout';
    }
  | {
      event: 'fc_notify.recipient_resolution';
      reason: 'no_admin_recipients';
    }
  | {
      event: 'fc_notify.attachment_cleanup';
      reason: 'storage_remove_failed';
    }
  | {
      event: 'fc_notify.notification_insert';
      reason: 'insert_failed';
    }
  | {
      event: 'fc_notify.device_token_load';
      reason: 'query_failed';
    }
  | {
      event: 'user_presence.rpc_fallback';
      reason: 'get_failed' | 'touch_failed' | 'stale_failed';
    }
  | {
      event: 'referral_tree.load';
      reason: 'rpc_and_fallback_failed';
    }
  | {
      event: 'board_create.push_fanout';
      reason: 'upstream_rejected' | 'request_failed';
    }
  | {
      event: 'board_create.notification_insert';
      reason: 'insert_failed';
    }
  | {
      event: 'board_update.push_fanout';
      reason: 'upstream_rejected' | 'request_failed';
    }
  | {
      event: 'board_update.notification_insert';
      reason: 'insert_failed';
    }
  | {
      event: 'board_attachment.storage';
      reason: 'delete_failed' | 'signed_upload_url_failed';
    }
  | {
      event: 'board.view_tracking';
      reason: 'view_tracking_failed';
    }
  | {
      event: 'board.database_operation';
      reason: 'database_operation_failed';
    }
  | {
      event: 'delete_account.auth_cleanup';
      reason: 'auth_user_delete_failed' | 'manager_shadow_auth_user_delete_failed';
    }
  | {
      event: 'delete_account.storage_cleanup';
      reason:
        | 'fc_documents_remove_failed'
        | 'board_attachments_remove_failed'
        | 'chat_uploads_remove_failed';
    };

type EdgeDiagnosticFields = Readonly<{
  status?: number;
  count?: number;
  retryable?: boolean;
  errorClass?: EdgeDiagnosticErrorClass;
}>;

export type EdgeDiagnosticInput = Readonly<EdgeDiagnosticPair & EdgeDiagnosticFields>;

type EdgeDiagnosticAllowedKey = 'event' | 'reason' | 'status' | 'count' | 'retryable' | 'errorClass';
type ExactEdgeDiagnostic<T extends EdgeDiagnosticInput> = T &
  Record<Exclude<keyof T, EdgeDiagnosticAllowedKey>, never>;

export type EdgeDiagnosticWriter = <const T extends EdgeDiagnosticInput>(
  input: ExactEdgeDiagnostic<T>,
) => void;

export type EdgeDiagnosticRecord = Readonly<{
  event: EdgeDiagnosticInput['event'] | 'edge_diagnostic.rejected';
  reason: EdgeDiagnosticInput['reason'] | 'invalid_diagnostic_input';
  status?: number;
  count?: number;
  retryable?: boolean;
  errorClass?: EdgeDiagnosticErrorClass;
}>;

const VALID_PAIRS = new Set<string>([
  'set_password.referral_resolution:not_found_or_inactive',
  'set_password.referral_resolution:inviter_hint_mismatch',
  'set_password.referral_resolution:code_lookup_failed',
  'set_password.referral_resolution:inviter_profile_lookup_failed',
  'set_password.referral_resolution:unexpected_error',
  'set_password.referral_event:insert_failed',
  'set_password.referral_link:apply_failed',
  'login_with_password.referral_bootstrap:referral_code_auto_issue_failed',
  'login_with_password.referral_bootstrap:manager_shadow_ensure_failed',
  'login_with_password.referral_bootstrap:manager_shadow_lookup_failed',
  'request_board.password_sync:upstream_rejected',
  'request_board.password_sync:invalid_response',
  'request_board.password_sync:request_failed',
  'request_board.password_sync:timeout',
  'fc_notify.admin_web_push:upstream_rejected',
  'fc_notify.admin_web_push:request_failed',
  'fc_notify.expo_push:request_failed',
  'fc_notify.expo_push:timeout',
  'fc_notify.recipient_resolution:no_admin_recipients',
  'fc_notify.attachment_cleanup:storage_remove_failed',
  'fc_notify.notification_insert:insert_failed',
  'fc_notify.device_token_load:query_failed',
  'user_presence.rpc_fallback:get_failed',
  'user_presence.rpc_fallback:touch_failed',
  'user_presence.rpc_fallback:stale_failed',
  'referral_tree.load:rpc_and_fallback_failed',
  'board_create.push_fanout:upstream_rejected',
  'board_create.push_fanout:request_failed',
  'board_create.notification_insert:insert_failed',
  'board_update.push_fanout:upstream_rejected',
  'board_update.push_fanout:request_failed',
  'board_update.notification_insert:insert_failed',
  'board_attachment.storage:delete_failed',
  'board_attachment.storage:signed_upload_url_failed',
  'board.view_tracking:view_tracking_failed',
  'board.database_operation:database_operation_failed',
  'delete_account.auth_cleanup:auth_user_delete_failed',
  'delete_account.auth_cleanup:manager_shadow_auth_user_delete_failed',
  'delete_account.storage_cleanup:fc_documents_remove_failed',
  'delete_account.storage_cleanup:board_attachments_remove_failed',
  'delete_account.storage_cleanup:chat_uploads_remove_failed',
]);

const ERROR_CLASSES = new Set<EdgeDiagnosticErrorClass>([
  'network',
  'timeout',
  'upstream',
  'database',
  'authentication',
]);

const MAX_SAFE_COUNT = 1_000_000;

export function buildEdgeDiagnosticRecord<const T extends EdgeDiagnosticInput>(
  input: ExactEdgeDiagnostic<T>,
): EdgeDiagnosticRecord {
  const candidate = input as unknown as Record<string, unknown>;
  const event = candidate.event;
  const reason = candidate.reason;

  if (
    typeof event !== 'string'
    || typeof reason !== 'string'
    || !VALID_PAIRS.has(`${event}:${reason}`)
  ) {
    return Object.freeze({
      event: 'edge_diagnostic.rejected',
      reason: 'invalid_diagnostic_input',
    });
  }

  const record: {
    event: EdgeDiagnosticRecord['event'];
    reason: EdgeDiagnosticRecord['reason'];
    status?: number;
    count?: number;
    retryable?: boolean;
    errorClass?: EdgeDiagnosticErrorClass;
  } = { event: event as EdgeDiagnosticInput['event'], reason: reason as EdgeDiagnosticInput['reason'] };

  if (Number.isInteger(candidate.status) && Number(candidate.status) >= 100 && Number(candidate.status) <= 599) {
    record.status = Number(candidate.status);
  }
  if (Number.isInteger(candidate.count) && Number(candidate.count) >= 0 && Number(candidate.count) <= MAX_SAFE_COUNT) {
    record.count = Number(candidate.count);
  }
  if (typeof candidate.retryable === 'boolean') {
    record.retryable = candidate.retryable;
  }
  if (typeof candidate.errorClass === 'string' && ERROR_CLASSES.has(candidate.errorClass as EdgeDiagnosticErrorClass)) {
    record.errorClass = candidate.errorClass as EdgeDiagnosticErrorClass;
  }

  return Object.freeze(record);
}

export const reportEdgeDiagnostic: EdgeDiagnosticWriter = (input) => {
  const record = buildEdgeDiagnosticRecord(input);
  try {
    if (record.event === 'board.database_operation') {
      console.error('[edge-diagnostic]', record);
      return;
    }
    console.warn('[edge-diagnostic]', record);
  } catch {
    // Diagnostics are deliberately best effort and must never alter product behavior.
  }
};

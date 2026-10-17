import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { buildAdminAuditRow, type AdminAuditActor, type AdminAuditCategory, type AdminAuditEventInput } from '@/lib/admin-audit-event';
import { logger } from '@/lib/logger';

/** Appends one audit row. Returns false when it could not be stored. */
export async function recordAdminAuditEvent(actor: AdminAuditActor, event: AdminAuditEventInput): Promise<boolean> {
  try {
    const { error } = await adminSupabase.from('admin_audit_events').insert(buildAdminAuditRow(actor, event));
    if (error) {
      logger.error('[admin-audit] insert failed', { category: event.category, action: event.action, code: error.code ?? 'unknown' });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('[admin-audit] insert rejected', {
      category: event.category,
      action: event.action,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

export type AdminAuditListItem = {
  id: string;
  createdAt: string;
  category: AdminAuditCategory;
  action: string;
  actorName: string;
  targetFcId: string | null;
  targetName: string | null;
  targetCount: number;
  detail: Record<string, unknown>;
  reason: string | null;
};

type AuditRow = {
  id: string; created_at: string; category: AdminAuditCategory; action: string; actor_role: string;
  actor_phone: string; target_fc_id: string | null; target_count: number; detail: Record<string, unknown> | null; reason: string | null;
};
type ExamDecisionRow = {
  id: string; created_at: string; action: string; from_status: string | null; to_status: string | null;
  reason: string | null; actor_admin_id_snapshot: string | null; target_fc_id_snapshot: string | null;
};

const EXAM_ADMIN_ACTIONS = ['confirmed', 'unconfirmed', 'rejected', 'cancelled_by_admin'];
const digits = (value: unknown) => String(value ?? '').replace(/[^0-9]/g, '');

/**
 * Lists audit rows plus admin exam-reception decisions (already logged in
 * exam_registration_decision_events) for one time window, newest first.
 */
export async function listAdminAuditEvents(options: {
  from: string;
  to: string;
  category: AdminAuditCategory | null;
  limit: number;
}): Promise<AdminAuditListItem[]> {
  let auditQuery = adminSupabase
    .from('admin_audit_events')
    .select('id,created_at,category,action,actor_role,actor_phone,target_fc_id,target_count,detail,reason')
    .gte('created_at', options.from)
    .lt('created_at', options.to)
    .order('created_at', { ascending: false })
    .limit(options.limit);
  if (options.category) auditQuery = auditQuery.eq('category', options.category);
  const includeExam = !options.category || options.category === 'fc_action';

  const [auditResult, examResult, adminsResult, managersResult] = await Promise.all([
    auditQuery,
    includeExam
      ? adminSupabase
        .from('exam_registration_decision_events')
        .select('id,created_at,action,from_status,to_status,reason,actor_admin_id_snapshot,target_fc_id_snapshot')
        .eq('actor_type', 'admin')
        .in('action', EXAM_ADMIN_ACTIONS)
        .gte('created_at', options.from)
        .lt('created_at', options.to)
        .order('created_at', { ascending: false })
        .limit(options.limit)
      : Promise.resolve({ data: [], error: null }),
    adminSupabase.from('admin_accounts').select('id,name,phone'),
    adminSupabase.from('manager_accounts').select('name,phone'),
  ]);
  for (const result of [auditResult, examResult, adminsResult, managersResult]) {
    if (result.error) throw result.error;
  }

  const admins = (adminsResult.data ?? []) as { id: string; name: string | null; phone: string | null }[];
  const managers = (managersResult.data ?? []) as { name: string | null; phone: string | null }[];
  const nameByPhone = new Map<string, string>();
  for (const account of [...managers, ...admins]) nameByPhone.set(digits(account.phone), String(account.name ?? '').trim());
  const nameByAdminId = new Map(admins.map((account) => [account.id, String(account.name ?? '').trim()]));

  const auditRows = (auditResult.data ?? []) as AuditRow[];
  const examRows = (examResult.data ?? []) as ExamDecisionRow[];
  const items: AdminAuditListItem[] = [
    ...auditRows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      category: row.category,
      action: row.action,
      actorName: nameByPhone.get(digits(row.actor_phone)) || (row.actor_role === 'manager' ? '본부장' : '관리자'),
      targetFcId: row.target_fc_id,
      targetName: null,
      targetCount: row.target_count,
      detail: row.detail ?? {},
      reason: row.reason,
    })),
    ...examRows.map((row) => ({
      id: `exam:${row.id}`,
      createdAt: row.created_at,
      category: 'fc_action' as const,
      action: `exam_${row.action}`,
      actorName: (row.actor_admin_id_snapshot && nameByAdminId.get(row.actor_admin_id_snapshot)) || '관리자',
      targetFcId: row.target_fc_id_snapshot,
      targetName: null,
      targetCount: row.target_fc_id_snapshot ? 1 : 0,
      detail: { from: row.from_status, to: row.to_status },
      reason: row.reason,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, options.limit);

  const fcIds = [...new Set(items.map((item) => item.targetFcId).filter((id): id is string => Boolean(id)))];
  if (fcIds.length > 0) {
    const { data, error } = await adminSupabase.from('fc_profiles').select('id,name').in('id', fcIds);
    if (error) throw error;
    const nameByFc = new Map(((data ?? []) as { id: string; name: string | null }[]).map((fc) => [fc.id, fc.name ?? null]));
    for (const item of items) item.targetName = item.targetFcId ? nameByFc.get(item.targetFcId) ?? null : null;
  }
  return items;
}

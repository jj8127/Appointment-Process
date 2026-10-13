import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';

export type AdminDocumentWorkflowRow = {
  id: string;
  fc_id: string;
  status: string;
  storage_path: string | null;
};

const isAdminDocumentWorkflowRow = (value: unknown): value is AdminDocumentWorkflowRow => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof (value as { id?: unknown }).id === 'string'
  && (value as { id: string }).id.trim().length > 0
  && typeof (value as { fc_id?: unknown }).fc_id === 'string'
  && (value as { fc_id: string }).fc_id.trim().length > 0
  && typeof (value as { status?: unknown }).status === 'string'
  && (value as { status: string }).status.trim().length > 0
  && (
    (value as { storage_path?: unknown }).storage_path === null
    || typeof (value as { storage_path?: unknown }).storage_path === 'string'
  )
);

export async function readAdminDocumentWorkflowRows(
  fcId: string,
  queryName: string,
): Promise<AdminDocumentWorkflowRow[]> {
  const requestedFcId = fcId.trim();
  if (!requestedFcId) throw new Error(`${queryName}_request_contract_invalid`);
  const rows = await collectSupabaseRows({
    queryName,
    isRow: isAdminDocumentWorkflowRow,
    rowKey: (row) => row.id,
    fetchPage: async (from, to) => adminSupabase
      .from('fc_documents')
      .select('id,fc_id,status,storage_path')
      .eq('fc_id', requestedFcId)
      .order('id', { ascending: true })
      .range(from, to),
  });
  if (rows.some((row) => row.fc_id !== requestedFcId)) {
    throw new Error(`${queryName}_identity_contract_invalid`);
  }
  return rows;
}

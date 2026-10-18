import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/hooks/use-session';
import { normalizeIdentityCompleted } from '@/lib/identity-completion';
import { requireSupabaseRowMatching } from '@/lib/supabase-query-contract';

type IdentityStatus = {
  fcId: string | null;
  identityCompleted: boolean;
  residentMasked: string | null;
  address: string | null;
  name: string | null;
};

type IdentityStatusRow = {
  id: string;
  name: string | null;
  resident_id_masked: string | null;
  address: string | null;
  identity_completed: boolean;
};

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isIdentityStatusRow = (value: unknown): value is IdentityStatusRow => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && row.id.trim().length > 0
    && isNullableString(row.name)
    && isNullableString(row.resident_id_masked)
    && isNullableString(row.address)
    && typeof row.identity_completed === 'boolean';
};

export async function fetchIdentityStatus(residentId: string): Promise<IdentityStatus> {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id, name, resident_id_masked, address, identity_completed')
    .eq('phone', residentId)
    .maybeSingle();

  if (error) throw error;

  const row = requireSupabaseRowMatching(
    data,
    'identity_status_profile',
    isIdentityStatusRow,
  );
  return {
    fcId: row.id,
    identityCompleted: normalizeIdentityCompleted(row),
    residentMasked: row.resident_id_masked,
    address: row.address,
    name: row.name,
  };
}

export function useIdentityStatus() {
  const { role, residentId, hydrated, isRequestBoardDesigner } = useSession();
  const enabled = hydrated && role === 'fc' && !!residentId && !isRequestBoardDesigner;

  return useQuery({
    queryKey: ['identity-status', residentId],
    queryFn: () => fetchIdentityStatus(residentId ?? ''),
    enabled,
  });
}

export type { IdentityStatus };

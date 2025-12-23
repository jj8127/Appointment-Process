import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/hooks/use-session';

type IdentityStatus = {
  fcId: string | null;
  identityCompleted: boolean;
  residentMasked: string | null;
  address: string | null;
  name: string | null;
};

const normalizeIdentityCompleted = (row: any) =>
  Boolean(row?.identity_completed) || Boolean(row?.resident_id_masked && row?.address);

export async function fetchIdentityStatus(residentId: string): Promise<IdentityStatus> {
  const { data, error } = await supabase
    .from('fc_profiles')
    .select('id, name, resident_id_masked, address, identity_completed')
    .eq('phone', residentId)
    .limit(1);

  if (error) throw error;

  const row = data?.[0];
  return {
    fcId: row?.id ?? null,
    identityCompleted: normalizeIdentityCompleted(row),
    residentMasked: row?.resident_id_masked ?? null,
    address: row?.address ?? null,
    name: row?.name ?? null,
  };
}

export function useIdentityStatus() {
  const { role, residentId, hydrated } = useSession();
  const enabled = hydrated && role === 'fc' && !!residentId;

  return useQuery({
    queryKey: ['identity-status', residentId],
    queryFn: () => fetchIdentityStatus(residentId ?? ''),
    enabled,
  });
}

export type { IdentityStatus };

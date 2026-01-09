import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FcProfile } from '@/types/fc';

interface FcRow extends FcProfile {
  fc_documents?: {
    doc_type: string;
    storage_path: string | null;
    file_name?: string | null;
    status?: string | null;
    reviewer_note?: string | null;
  }[];
}

export const fetchFcs = async (
  role: 'admin' | 'fc' | null,
  residentId: string,
  keyword: string,
): Promise<FcRow[]> => {
  let query = supabase
    .from('fc_profiles')
    .select(
      'id,name,affiliation,phone,temp_id,status,allowance_date,appointment_url,appointment_date,docs_deadline_at,appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,appointment_date_life_sub,appointment_date_nonlife_sub,appointment_reject_reason_life,appointment_reject_reason_nonlife,resident_id_masked,career_type,email,address,address_detail,fc_documents(doc_type,storage_path,file_name,status,reviewer_note)',
    )
    .order('created_at', { ascending: false });

  if (role === 'fc' && residentId) {
    query = query.eq('phone', residentId);
  }
  if (keyword) {
    query = query.or(
      `name.ilike.%${keyword}%,affiliation.ilike.%${keyword}%,phone.ilike.%${keyword}%,temp_id.ilike.%${keyword}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('[useDashboardData] fetchFcs query error', {
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
      role,
      residentId,
      keyword,
    });
    throw error;
  }
  return data as FcRow[];
};

export function useDashboardData(
  role: 'admin' | 'fc' | null,
  residentId: string,
  keyword: string,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ['fc-profiles', role, residentId, keyword],
    queryFn: () => fetchFcs(role, residentId, keyword),
    enabled,
  });
}

// Update temp ID mutation
export function useUpdateTempId() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fcId, tempId }: { fcId: string; tempId: string }) => {
      const { error } = await supabase
        .from('fc_profiles')
        .update({ temp_id: tempId, status: 'temp-id-issued' })
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

// Update career type mutation
export function useUpdateCareerType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fcId, careerType }: { fcId: string; careerType: '신입' | '경력' }) => {
      const { error } = await supabase
        .from('fc_profiles')
        .update({ career_type: careerType })
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

// Update document deadline mutation
export function useUpdateDocDeadline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fcId, deadline }: { fcId: string; deadline: string | null }) => {
      const { error } = await supabase
        .from('fc_profiles')
        .update({ docs_deadline_at: deadline })
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

// Update allowance date mutation
export function useUpdateAllowanceDate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fcId, date, approved }: { fcId: string; date: string; approved: boolean }) => {
      const status = approved ? 'allowance-consented' : 'allowance-pending';
      const { error } = await supabase
        .from('fc_profiles')
        .update({ allowance_date: date, status })
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

// Reject allowance mutation
export function useRejectAllowance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fcId, reason }: { fcId: string; reason: string }) => {
      const { error } = await supabase
        .from('fc_profiles')
        .update({
          allowance_reject_reason: reason,
          status: 'allowance-pending',
        })
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

// Delete FC mutation
export function useDeleteFC() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fcId: string) => {
      const { error } = await supabase
        .from('fc_profiles')
        .delete()
        .eq('id', fcId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-profiles'] });
    },
  });
}

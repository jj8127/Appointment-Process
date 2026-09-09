import 'server-only';

import { adminSupabase } from '@/lib/admin-supabase';
import { buildPhoneCandidates, type VerifiedServerSession } from '@/lib/server-session';

export const ALLOWANCE_IMPORT_COLUMNS = 'id,status,revision,source_sha256,policy_version,performance_month,payment_date,genealogy_as_of,pilot_revision,created_at,published_at,snapshot';

export async function allowanceAdminId(session: VerifiedServerSession): Promise<string> {
  const { data, error } = await adminSupabase.from('admin_accounts').select('id').eq('active', true)
    .in('phone', buildPhoneCandidates(session.residentId, session.residentDigits)).maybeSingle();
  if (error || !data?.id) throw new Error('admin_unavailable');
  return data.id;
}

export type AllowanceRecipient = { manager_account_id: string | null; beneficiary_fc_id: string; employee_code: string; enabled: boolean; revision: number };

export async function getAllowancePilot(beneficiaryFcId: string) {
  const { data, error } = await adminSupabase.from('referral_allowance_recipients')
    .select('manager_account_id,beneficiary_fc_id,employee_code,enabled,revision').eq('beneficiary_fc_id', beneficiaryFcId).maybeSingle();
  if (error) throw new Error('pilot_unavailable');
  return data as AllowanceRecipient | null;
}

export async function listAllowanceRecipients() {
  const { data, error } = await adminSupabase.from('referral_allowance_recipients')
    .select('manager_account_id,beneficiary_fc_id,employee_code,enabled,revision,fc_profiles!beneficiary_fc_id(name)')
    .order('created_at').order('beneficiary_fc_id').limit(5000);
  if (error) throw new Error('recipients_unavailable');
  return (data ?? []).map((row) => {
    const profile = row.fc_profiles as unknown as { name: string } | null;
    return { manager_account_id: row.manager_account_id, beneficiary_fc_id: row.beneficiary_fc_id,
      employee_code: row.employee_code, enabled: row.enabled, revision: row.revision,
      name: profile?.name ?? '' } as AllowanceRecipient & { name: string };
  });
}

export async function findAllowanceCandidates(search: string) {
  if (search.trim().length < 2) return [];
  const literal = search.trim().replace(/[\\%_]/g, '\\$&');
  const { data: profiles, error: profileError } = await adminSupabase.from('fc_profiles')
    .select('id,name,phone,signup_completed,is_manager_referral_shadow,affiliation').ilike('name', `%${literal}%`).order('id').limit(20);
  if (profileError) throw new Error('profile_unavailable');
  if (!profiles?.length) return [];
  const { data: managers, error } = await adminSupabase.from('manager_accounts').select('id,phone,active').in('phone', profiles.map((p) => p.phone));
  if (error) throw new Error('manager_unavailable');
  const { data: admins, error: adminError } = await adminSupabase.from('admin_accounts').select('phone').in('phone', profiles.map((p) => p.phone));
  if (adminError) throw new Error('admin_unavailable');
  return profiles.flatMap((profile) => {
    const manager = managers?.find((item) => item.phone === profile.phone);
    if (admins?.some((admin) => admin.phone === profile.phone)
      || String(profile.affiliation ?? '').includes('설계매니저')
      || (manager ? !manager.active || !(profile.signup_completed || profile.is_manager_referral_shadow)
        : !profile.signup_completed || profile.is_manager_referral_shadow)) return [];
    return [{ managerAccountId: manager?.id ?? null, beneficiaryFcId: profile.id, name: profile.name, affiliation: profile.affiliation ?? '' }];
  });
}

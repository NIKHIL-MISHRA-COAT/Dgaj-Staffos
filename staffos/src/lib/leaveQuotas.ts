// Single source for leave entitlements.
// Director Settings / Firm Configuration save quotas per role in
// director_settings['leave_quotas_by_fy'] and sync them into leave_balances.
// Every leave screen reads from here, so nothing is hard-coded.

import type { SupabaseClient } from '@supabase/supabase-js';

export type QuotaType = 'substitute' | 'paid' | 'unpaid' | 'medical' | 'half_day';
export type RoleQuotas = Partial<Record<QuotaType, number>>;
export type SavedQuotas = Record<string, RoleQuotas>;

export async function fetchSavedQuotas(supabase: SupabaseClient): Promise<SavedQuotas> {
  const { data } = await supabase
    .from('director_settings')
    .select('setting_value')
    .eq('setting_key', 'leave_quotas_by_fy')
    .maybeSingle();
  return ((data?.setting_value as SavedQuotas | null) ?? {});
}

// Quota for a role. Falls back to the employee row, then to an empty quota (0 days).
export function quotaForRole(saved: SavedQuotas, role?: string | null): RoleQuotas {
  const key = (role || 'employee').toLowerCase();
  return saved[key] ?? saved.employee ?? {};
}

export function quotaValue(quota: RoleQuotas, type: string): number {
  return Number(quota[type as QuotaType]) || 0;
}
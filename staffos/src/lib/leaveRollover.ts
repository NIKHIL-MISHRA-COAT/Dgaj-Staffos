import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Year-end leave rollover.
 *
 * Every employee's unused leave (total_days − used_days) from the closing
 * financial year is carried into the next year, with no cap and no expiry.
 * The next year's total = that year's entitlement + carried days.
 *
 * Safe to run more than once: the entitlement is recalculated from the
 * next-year row (total − carry), so carried days are never added twice.
 */

// Same defaults as the Leave Admin screen.
const DEFAULT_QUOTAS: Record<string, number> = {
  substitute: 12,
  paid: 15,
  medical: 8,
  half_day: 10,
};

// Unpaid leave is not an entitlement, so it is never carried.
const CARRYABLE_TYPES_EXCLUDE = ['unpaid'];

/** Financial year starting April. 2026 means FY 2026-27. */
export function getFiscalYear(date: Date = new Date()): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export interface RolloverResult {
  employeesAffected: number;
  rowsWritten: number;
  daysCarried: number;
}

export async function rolloverLeave(
  supabase: SupabaseClient,
  opts: { fromFY: number; toFY: number; firmIds: string[] }
): Promise<RolloverResult> {
  const { fromFY, toFY, firmIds } = opts;
  const empty: RolloverResult = { employeesAffected: 0, rowsWritten: 0, daysCarried: 0 };
  if (firmIds.length === 0) return empty;

  // Entitlements for the new year, if the director has set them.
  const { data: quotaRow, error: quotaErr } = await supabase
    .from('director_settings')
    .select('setting_value')
    .eq('setting_key', 'leave_quotas_by_fy')
    .maybeSingle();
  if (quotaErr) throw quotaErr;
  const fyKey = `${toFY}-${toFY + 1}`;
  const savedQuotas: Record<string, number> =
    ((quotaRow?.setting_value as Record<string, Record<string, number>> | null)?.[fyKey]) ?? {};

  // Closing year balances.
  const { data: prevRows, error: prevErr } = await supabase
    .from('leave_balances')
    .select('user_id, firm_id, leave_type, total_days, used_days')
    .eq('fiscal_year', fromFY)
    .in('firm_id', firmIds)
    .not('leave_type', 'in', `(${CARRYABLE_TYPES_EXCLUDE.join(',')})`);
  if (prevErr) throw prevErr;
  if (!prevRows || prevRows.length === 0) return empty;

  // Rows that already exist for the new year (keeps approved leave and avoids double-carrying).
  const { data: nextRows, error: nextErr } = await supabase
    .from('leave_balances')
    .select('user_id, leave_type, total_days, used_days, carry_forward_days')
    .eq('fiscal_year', toFY)
    .in('firm_id', firmIds);
  if (nextErr) throw nextErr;

  const nextMap = new Map<string, { total_days: number; used_days: number; carry_forward_days: number }>();
  for (const r of (nextRows || []) as any[]) {
    nextMap.set(`${r.user_id}|${r.leave_type}`, {
      total_days: Number(r.total_days) || 0,
      used_days: Number(r.used_days) || 0,
      carry_forward_days: Number(r.carry_forward_days) || 0,
    });
  }

  const rows: Record<string, unknown>[] = [];
  const employees = new Set<string>();
  let daysCarried = 0;

  for (const p of prevRows as any[]) {
    const remaining = Math.max(0, (Number(p.total_days) || 0) - (Number(p.used_days) || 0));
    const existing = nextMap.get(`${p.user_id}|${p.leave_type}`);

    // Entitlement for the new year, without any carry already added to it.
    const entitlement = existing
      ? existing.total_days - existing.carry_forward_days
      : (savedQuotas[p.leave_type] ?? DEFAULT_QUOTAS[p.leave_type] ?? 0);

    rows.push({
      user_id: p.user_id,
      firm_id: p.firm_id,
      leave_type: p.leave_type,
      fiscal_year: toFY,
      total_days: entitlement + remaining,
      used_days: existing ? existing.used_days : 0,
      carry_forward_days: remaining,
    });

    employees.add(p.user_id);
    daysCarried += remaining;
  }

  // Upsert in chunks to keep request size small.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('leave_balances')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,leave_type,fiscal_year' });
    if (error) throw error;
  }

  return { employeesAffected: employees.size, rowsWritten: rows.length, daysCarried };
}
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Weekly holidays (director-only).
 *
 * A weekly holiday is stored as one `company_holidays` row per matching date,
 * so attendance, payroll and leave logic already treat those days as holidays
 * with no extra wiring. Rows are tagged with holiday_type = 'weekly_off' so the
 * rule can be listed and removed later without touching public holidays.
 */

export const WEEKLY_HOLIDAY_TYPE = 'weekly_off';
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local date string (YYYY-MM-DD). Never use toISOString() here — it shifts dates in IST. */
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const todayStr = () => toDateStr(new Date());

/** Adds months to a YYYY-MM-DD string and returns a YYYY-MM-DD string. */
export const plusMonthsStr = (dateStr: string, months: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + months, d);
  return toDateStr(target);
};

/** Parses YYYY-MM-DD as a local date (avoids the UTC shift of new Date('YYYY-MM-DD')). */
const parseLocal = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Financial year starting April, matching the rest of the holiday module. */
const fiscalYearFor = (dateStr: string) => {
  const d = parseLocal(dateStr);
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};

export interface WeeklyHolidayRule {
  weekday: number;
  name: string;
  count: number;
  firstDate: string;
  lastDate: string;
}

/**
 * Creates a holiday row for every `weekday` between `from` and `to` (inclusive).
 * Dates that already have a holiday (public or another weekly rule) are left as they are.
 * Returns how many rows were actually added.
 */
export async function addWeeklyHolidays(
  supabase: SupabaseClient,
  opts: { weekday: number; from: string; to: string; name: string; createdBy?: string | null }
): Promise<{ added: number; skipped: number }> {
  const { weekday, from, to, name, createdBy } = opts;
  const rows: Record<string, unknown>[] = [];

  const cursor = parseLocal(from);
  const end = parseLocal(to);
  while (cursor <= end) {
    if (cursor.getDay() === weekday) {
      const dateStr = toDateStr(cursor);
      rows.push({
        name,
        holiday_date: dateStr,
        holiday_type: WEEKLY_HOLIDAY_TYPE,
        fiscal_year: fiscalYearFor(dateStr),
        notes: `Weekly holiday — every ${WEEKDAY_NAMES[weekday]}`,
        created_by: createdBy ?? null,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (rows.length === 0) return { added: 0, skipped: 0 };

  // holiday_date is unique, so existing holidays on the same day are kept as-is.
  const { data, error } = await supabase
    .from('company_holidays')
    .upsert(rows, { onConflict: 'holiday_date', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;

  const added = data?.length ?? 0;
  return { added, skipped: rows.length - added };
}

/** Lists weekly holiday rules from today onward, grouped by weekday. */
export async function listWeeklyHolidays(
  supabase: SupabaseClient,
  fromDate: string = todayStr()
): Promise<WeeklyHolidayRule[]> {
  const { data, error } = await supabase
    .from('company_holidays')
    .select('name, holiday_date')
    .eq('holiday_type', WEEKLY_HOLIDAY_TYPE)
    .gte('holiday_date', fromDate)
    .order('holiday_date');
  if (error) throw error;

  const groups = new Map<number, WeeklyHolidayRule>();
  for (const row of (data || []) as { name: string; holiday_date: string }[]) {
    const weekday = parseLocal(row.holiday_date).getDay();
    const existing = groups.get(weekday);
    if (existing) {
      existing.count += 1;
      existing.lastDate = row.holiday_date;
    } else {
      groups.set(weekday, {
        weekday,
        name: row.name,
        count: 1,
        firstDate: row.holiday_date,
        lastDate: row.holiday_date,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.weekday - b.weekday);
}

/**
 * Removes a weekly rule: deletes every weekly_off row on `weekday` from `fromDate` onward.
 * Public holidays are never touched.
 */
export async function removeWeeklyHolidays(
  supabase: SupabaseClient,
  opts: { weekday: number; fromDate?: string }
): Promise<number> {
  const { weekday, fromDate = todayStr() } = opts;
  const { data, error } = await supabase
    .from('company_holidays')
    .select('id, holiday_date')
    .eq('holiday_type', WEEKLY_HOLIDAY_TYPE)
    .gte('holiday_date', fromDate);
  if (error) throw error;

  const ids = ((data || []) as { id: string; holiday_date: string }[])
    .filter((r) => parseLocal(r.holiday_date).getDay() === weekday)
    .map((r) => r.id);
  if (ids.length === 0) return 0;

  const { error: delError } = await supabase.from('company_holidays').delete().in('id', ids);
  if (delError) throw delError;
  return ids.length;
}
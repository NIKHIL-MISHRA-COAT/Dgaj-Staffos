// Shared attendance calendar logic.
//
// Used by the Attendance Records tab (own cards + team table) and by Payroll
// auto-fill, so working days, present days and absent days are counted the
// same way everywhere. Working days come from the company calendar
// (company_holidays, which also holds weekly-off rows) minus Sat/Sun.

export type AttendanceStatus =
  | 'present' | 'absent' | 'late' | 'half_day' | 'work_from_home'
  | 'holiday' | 'weekend' | 'paid_leave' | 'unpaid_leave';

export type LeaveInfo = { status: 'paid_leave' | 'unpaid_leave'; pending: boolean };
export type HolidayMap = Record<string, string>; // 'YYYY-MM-DD' -> holiday name
export type LeaveMap = Record<string, LeaveInfo>; // `${userId}|${YYYY-MM-DD}` -> leave

export interface CalendarRecord {
  work_date: string;
  status: AttendanceStatus;
  clock_in: string | null;
  total_hours?: number | null;
  overtime_hours?: number | null;
}

// Local-date helpers. Do NOT use toISOString() for date-only strings: in IST
// (UTC+5:30) local midnight becomes the previous UTC day.
export const pad2 = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function eachDateInRange(start: string, end: string, cb: (dateStr: string) => void) {
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    cb(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
}

/** Working hours for a day = regular hours + overtime hours */
export const dayHours = (r: { total_hours?: number | null; overtime_hours?: number | null }) =>
  (Number(r.total_hours) || 0) + (Number(r.overtime_hours) || 0);

export function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

/** Company calendar for a date range: one entry per holiday date (includes weekly-off rows). */
export function buildHolidayMap(rows: { holiday_date: string; name: string }[]): HolidayMap {
  const m: HolidayMap = {};
  rows.forEach((h) => { m[String(h.holiday_date).slice(0, 10)] = h.name; });
  return m;
}

/** Approved and pending leave rows -> per-day map. Approved beats pending when both overlap. */
export function buildLeaveMap(
  leaves: { user_id: string; leave_type: string | null; start_date: string; end_date: string; status: string }[],
  startDate: string,
  endDate: string,
): LeaveMap {
  const lMap: LeaveMap = {};
  leaves.forEach((lv) => {
    const unpaid = /unpaid|lop|loss/i.test(String(lv.leave_type || ''));
    const pending = lv.status !== 'approved';
    eachDateInRange(lv.start_date, lv.end_date, (ds) => {
      if (ds < startDate || ds > endDate) return;
      const key = `${lv.user_id}|${ds}`;
      if (lMap[key] && !lMap[key].pending && pending) return;
      lMap[key] = { status: unpaid ? 'unpaid_leave' : 'paid_leave', pending };
    });
  });
  return lMap;
}

/**
 * Holiday / leave aware status for one day.
 *   worked day (present/late/half_day/wfh) ........ always wins
 *   company holiday ............................... holiday
 *   weekend ....................................... weekend
 *   approved leave ................................ paid / unpaid leave
 *   past working day, nothing recorded ............ absent
 *   today / future, nothing recorded .............. null
 */
export function resolveDayStatus(
  userId: string,
  dateStr: string,
  rec: { status: AttendanceStatus; clock_in: string | null } | undefined,
  holidayMap: HolidayMap,
  leaveMap: LeaveMap,
): AttendanceStatus | null {
  if (rec && (['present', 'late', 'half_day', 'work_from_home'].includes(rec.status) || rec.clock_in)) return rec.status;
  if (holidayMap[dateStr] || rec?.status === 'holiday') return 'holiday';
  if (isWeekend(dateStr) || rec?.status === 'weekend') return 'weekend';
  const leave = leaveMap[`${userId}|${dateStr}`];
  if (leave && !leave.pending) return leave.status;
  if (dateStr < toDateStr(new Date())) return 'absent';
  return rec && rec.status === 'absent' ? 'absent' : null;
}

export interface PeriodStats {
  workingDays: number;      // weekdays minus company holidays in the period
  workedDays: number;       // present + late + half day + WFH on working days
  lateDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;       // past working days with no work and no approved leave
  avgHoursPerWorkedDay: number;
}

/**
 * Counts one employee's period from the company calendar, their attendance rows
 * and their leave. Worked hours on a holiday/weekend are not counted as a working
 * day; they are paid through overtime.
 */
export function computePeriodStats(opts: {
  userId: string;
  startDate: string;
  endDate: string;
  records: CalendarRecord[];
  holidayMap: HolidayMap;
  leaveMap: LeaveMap;
}): PeriodStats {
  const { userId, startDate, endDate, records, holidayMap, leaveMap } = opts;
  const byDate: Record<string, CalendarRecord> = {};
  records.forEach((r) => { byDate[String(r.work_date).slice(0, 10)] = r; });

  let workingDays = 0, workedDays = 0, lateDays = 0, paidLeaveDays = 0, unpaidLeaveDays = 0, absentDays = 0;
  let workedHours = 0;

  eachDateInRange(startDate, endDate, (ds) => {
    if (isWeekend(ds) || holidayMap[ds]) return;
    const rec = byDate[ds];
    const st = resolveDayStatus(userId, ds, rec, holidayMap, leaveMap);
    if (st === 'holiday' || st === 'weekend') return;
    workingDays++;
    if (st === 'present' || st === 'late' || st === 'half_day' || st === 'work_from_home') {
      workedDays++;
      if (st === 'late') lateDays++;
      workedHours += dayHours(rec || {});
    } else if (st === 'paid_leave') paidLeaveDays++;
    else if (st === 'unpaid_leave') unpaidLeaveDays++;
    else if (st === 'absent') absentDays++;
  });

  return {
    workingDays,
    workedDays,
    lateDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    avgHoursPerWorkedDay: workedDays > 0 ? workedHours / workedDays : 0,
  };
}
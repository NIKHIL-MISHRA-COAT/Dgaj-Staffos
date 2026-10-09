'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import {
  Building2, TrendingUp, Users, CheckSquare, Calendar, Clock, Layers, RefreshCw, Download, Printer, Wallet, Receipt, CalendarDays,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend,
  Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

/* ------------------------------------------------------------------ types */
type Period = 'daily' | 'weekly' | 'monthly';
interface Firm { id: string; name: string; code: string; }
type Rec = { firm: string; day: number; status: string };
type EmpRec = { id: string; firm: string; role: string };
type PayRec = { firm: string; emp: string; key: string; gross: number; present: number; absent: number; perDay: number; deducted: number; net: number; status: string };
type ExpRec = { firm: string; emp: string; day: number; category: string; amount: number; reimbursed: number; status: string };
type StaffRec = { emp: string; day: number; status: string };
type Holiday = { day: number; name: string };
type Source = {
  firms: Firm[]; tasks: Rec[]; attendance: Rec[]; leaves: Rec[]; employees: EmpRec[]; todayNum: number;
  payroll: PayRec[]; expenses: ExpRec[]; holidays: Holiday[]; names: Record<string, string>;
  staffAtt: StaffRec[]; staffTasks: StaffRec[]; warn: Record<string, string>;
};

const UNASSIGNED = '__unassigned';
const WINDOW = 62; // days loaded, enough for the current and previous month-to-date
const PRESENT_LIKE = ['present', 'half_day', 'work_from_home']; // same rule as before
const EMPTY: Source = {
  firms: [], tasks: [], attendance: [], leaves: [], employees: [], todayNum: 0,
  payroll: [], expenses: [], holidays: [], names: {}, staffAtt: [], staffTasks: [], warn: {},
};

/* Columns for the newer sections (payroll, expenses, holidays, staff scorecard).
   If a section says it isn't connected, fix the table or column names here. */
const SCHEMA = {
  payroll: { table: 'payroll_records', emp: 'user_id', firm: 'firm_id', month: 'month', gross: 'gross_salary', present: 'present_days', absent: 'absent_days', perDay: 'deduction_per_day', deducted: 'total_deduction', net: 'net_salary', status: 'status' },
  expenses: { table: 'expenses', emp: 'user_id', firm: 'firm_id', date: 'created_at', category: 'category', amount: 'amount', reimbursed: 'reimbursed_amount', status: 'status' },
  holidays: { table: 'company_holidays', date: 'holiday_date', name: 'name' },
  staff: { name: 'full_name', attEmp: 'user_id', taskEmp: 'assigned_to' },
} as const;

const C = { teal: '#0d9488', amber: '#f59e0b', sky: '#0ea5e9', rose: '#e11d48', indigo: '#4f46e5', violet: '#7c3aed', slate: '#94a3b8', grid: 'rgba(148,163,184,0.25)' };
const PALETTE = [C.teal, C.indigo, C.amber, C.sky, C.rose, C.violet, C.slate];
const KNOWN_COLOR: Record<string, string> = {
  present: C.teal, half_day: C.sky, work_from_home: C.indigo, late: C.amber, absent: C.rose, leave: C.violet, on_leave: C.violet,
  done: C.teal, in_progress: C.indigo, todo: C.slate, pending: C.slate, overdue: C.rose, blocked: C.rose,
};
const colorFor = (key: string, i: number) => KNOWN_COLOR[key] ?? PALETTE[i % PALETTE.length];
const label = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Unknown');

/* ---------------------------------------------------------------- helpers */
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };
const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
const compact = (n: number) => (n >= 1e7 ? (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)));
const chg = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const numOfDate = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
const numOfYmd = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const dateOfNum = (n: number) => new Date(n * 86400000);
const fmtNum = (n: number) => dateOfNum(n).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Attendance rows sometimes have a blank status. A row with a clock-in is present;
// a row with neither a status nor a clock-in is a placeholder for not clocking in, so absent.
const normStatus = (status: any, clockIn: any): string => {
  const s = String(status ?? '').trim().toLowerCase();
  if (s) return s;
  return clockIn ? 'present' : 'absent';
};

async function fetchAll(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadAll(supabase: any): Promise<Source> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since = new Date(today); since.setDate(today.getDate() - (WINDOW - 1));
  const sinceDate = ymd(since);
  const sinceIso = since.toISOString();

  const [firmsRes, tasks, attendance, leaves, employees, leaveSpans] = await Promise.all([
    supabase.from('firms').select('id, name, code').order('name'),
    fetchAll(() => supabase.from('tasks').select('id, firm_id, status, created_at').gte('created_at', sinceIso).order('id')),
    fetchAll(() => supabase.from('attendance_records').select('id, user_id, firm_id, status, clock_in, work_date').gte('work_date', sinceDate).order('id')),
    fetchAll(() => supabase.from('leave_requests').select('id, firm_id, created_at').gte('created_at', sinceIso).order('id')),
    fetchAll(() => supabase.from('user_profiles').select('id, firm_id, role, created_at').eq('is_active', true).order('id')),
    // approved leave that overlaps the window: those days are leave, not absence
    fetchAll(() => supabase.from('leave_requests').select('user_id, start_date, end_date').eq('status', 'approved').lte('start_date', ymd(today)).gte('end_date', sinceDate).order('id')),
  ]);
  if (firmsRes.error) throw firmsRes.error;

  const fk = (v: any) => v || UNASSIGNED;
  const empFirm = new Map<string, string>(employees.map((r: any) => [String(r.id), fk(r.firm_id)]));

  // newer sections load independently, one failing never breaks the rest of the page
  const warn: Record<string, string> = {};
  const opt = async (key: string, run: () => Promise<any[]>): Promise<any[]> => {
    try { return await run(); } catch (e: any) { warn[key] = e?.message ?? 'query failed'; return []; }
  };
  const P = SCHEMA.payroll; const X = SCHEMA.expenses; const H = SCHEMA.holidays; const S = SCHEMA.staff;
  const [payRows, expRows, holRows, nameRows, sAtt, sTask] = await Promise.all([
    opt('payroll', () => fetchAll(() => supabase.from(P.table).select('*').order('id'))),
    opt('expenses', () => fetchAll(() => supabase.from(X.table).select('*').gte(X.date, sinceIso).order('id'))),
    opt('holidays', () => fetchAll(() => supabase.from(H.table).select('*').gte(H.date, sinceDate).order('id'))),
    opt('staff', () => fetchAll(() => supabase.from('user_profiles').select(`id, ${S.name}`).eq('is_active', true).order('id'))),
    opt('staff', () => fetchAll(() => supabase.from('attendance_records').select(`id, ${S.attEmp}, status, clock_in, work_date`).gte('work_date', sinceDate).order('id'))),
    opt('staff', () => fetchAll(() => supabase.from('tasks').select(`id, ${S.taskEmp}, status, created_at`).gte('created_at', sinceIso).order('id'))),
  ]);

  // Absent = a working day (not Sat/Sun, not a holiday) where an active employee has
  // no attendance record and no approved leave. Days before the employee's join date are skipped.
  const holidayDays = new Set<number>(holRows.filter((r: any) => r[H.date]).map((r: any) => numOfYmd(String(r[H.date]))));
  const attendanceKeys = new Set<string>(
    attendance
      .filter((r: any) => normStatus(r.status, r.clock_in) !== 'absent')
      .map((r: any) => `${r.user_id}|${numOfYmd(String(r.work_date))}`)
  );
  const onLeaveKeys = new Set<string>();
  leaveSpans.forEach((l: any) => {
    const end = numOfYmd(String(l.end_date));
    for (let d = numOfYmd(String(l.start_date)); d <= end; d++) onLeaveKeys.add(`${l.user_id}|${d}`);
  });
  const absentRows: { user_id: string; firm_id: string | null; work_date: string; status: string }[] = [];
  const lastNum = numOfDate(today);
  for (let d = numOfDate(since); d <= lastNum; d++) {
    const dow = dateOfNum(d).getUTCDay();
    if (dow === 0 || dow === 6 || holidayDays.has(d)) continue;
    const dateStr = dateOfNum(d).toISOString().slice(0, 10);
    for (const e of employees) {
      const joinNum = e.created_at ? numOfDate(new Date(e.created_at)) : 0;
      if (d < joinNum) continue;
      const key = `${e.id}|${d}`;
      if (attendanceKeys.has(key) || onLeaveKeys.has(key)) continue;
      absentRows.push({ user_id: String(e.id), firm_id: e.firm_id ?? null, work_date: dateStr, status: 'absent' });
    }
  }

  const payroll: PayRec[] = payRows.map((r: any) => {
    const emp = String(r[P.emp] ?? '');
    const gross = num(r[P.gross]); const absent = num(r[P.absent]);
    const perDay = r[P.perDay] != null ? num(r[P.perDay]) : 1000;
    const deducted = r[P.deducted] != null ? num(r[P.deducted]) : absent * perDay;
    const net = r[P.net] != null ? num(r[P.net]) : gross - deducted;
    return { firm: r[P.firm] || empFirm.get(emp) || UNASSIGNED, emp, key: String(r[P.month] ?? r.created_at ?? '').slice(0, 7), gross, present: num(r[P.present]), absent, perDay, deducted, net, status: String(r[P.status] ?? '').toLowerCase() };
  }).filter((p: PayRec) => /^\d{4}-\d{2}$/.test(p.key));

  const expenses: ExpRec[] = expRows.map((r: any) => {
    const st = String(r[X.status] ?? '').toLowerCase();
    const status = st.includes('reimburs') ? 'reimbursed' : st.includes('approv') ? 'approved' : st.includes('return') || st.includes('clarif') ? 'returned' : st.includes('reject') ? 'rejected' : 'pending';
    const amount = num(r[X.amount]);
    const emp = String(r[X.emp] ?? '');
    return {
      firm: r[X.firm] || empFirm.get(emp) || UNASSIGNED, emp, day: numOfDate(new Date(r[X.date])),
      category: label(String(r[X.category] ?? 'other').toLowerCase()), amount,
      reimbursed: r[X.reimbursed] != null ? num(r[X.reimbursed]) : status === 'reimbursed' ? amount : 0, status,
    };
  });

  const names: Record<string, string> = {};
  nameRows.forEach((r: any) => { names[String(r.id)] = r[S.name] ?? 'Employee'; });

  return {
    firms: (firmsRes.data as Firm[]) || [],
    tasks: tasks.map((r) => ({ firm: fk(r.firm_id), day: numOfDate(new Date(r.created_at)), status: String(r.status ?? '').toLowerCase() })),
    attendance: [...attendance, ...absentRows].map((r: any) => ({ firm: fk(r.firm_id), day: numOfYmd(String(r.work_date)), status: normStatus(r.status, r.clock_in) })),
    leaves: leaves.map((r) => ({ firm: fk(r.firm_id), day: numOfDate(new Date(r.created_at)), status: '' })),
    employees: employees.map((r) => ({ id: String(r.id), firm: fk(r.firm_id), role: String(r.role ?? 'employee').toLowerCase() })),
    todayNum: numOfDate(today),
    payroll, expenses, names, warn,
    holidays: holRows.filter((r: any) => r[H.date]).map((r: any) => ({ day: numOfYmd(String(r[H.date])), name: r[H.name] ?? 'Holiday' })),
    staffAtt: [
      ...sAtt.map((r: any) => ({ emp: String(r[S.attEmp]), day: numOfYmd(String(r.work_date)), status: normStatus(r.status, r.clock_in) })),
      ...absentRows.map((r) => ({ emp: r.user_id, day: numOfYmd(r.work_date), status: 'absent' })),
    ],
    staffTasks: sTask.map((r: any) => ({ emp: String(r[S.taskEmp]), day: numOfDate(new Date(r.created_at)), status: String(r.status ?? '').toLowerCase() })),
  };
}

/* ------------------------------------------------------------ small parts */
function ChartTip({ active, payload, label: l, money }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-600 dark:bg-slate-800">
      {l !== undefined && <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{l}</div>}
      {payload.map((p: any) => (
        <div key={String(p.dataKey) + p.name} className="flex items-center gap-2 text-slate-500 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill || p.payload?.color }} />
          {p.name}: <b className="text-slate-800 dark:text-slate-100">{money ? inr(p.value) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

function Tile({ title, hint, className = '', right, children }: { title: string; hint?: string; className?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 print:break-inside-avoid ${className}`}>
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
        {right}
      </header>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-slate-400">{text}</div>;
}

// True only in compare mode. Without it, KPI cards show no comparison arrows.
const CompareContext = createContext(false);

function Delta({ value, suffix = '', goodWhenUp = true, neutral = false }: { value: number; suffix?: string; goodWhenUp?: boolean; neutral?: boolean }) {
  const comparing = useContext(CompareContext);
  if (!comparing) return null;
  if (!isFinite(value) || Math.abs(value) < 0.5) return <span className="text-[11px] text-slate-400">No change vs previous</span>;
  const up = value > 0;
  const tone = neutral ? 'text-slate-500' : up === goodWhenUp ? 'text-teal-600' : 'text-rose-600';
  return (
    <span className={`text-[11px] font-medium ${tone}`}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(value))}{suffix} <span className="font-normal text-slate-400">vs previous</span>
    </span>
  );
}

function Kpi({ icon, name, value, sub, delta, spark, color }: { icon: React.ReactNode; name: string; value: React.ReactNode; sub?: string; delta?: React.ReactNode; spark?: number[]; color: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-400">{icon} {name}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
      {delta && <div className="mt-0.5">{delta}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v) => ({ v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <Area dataKey="v" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Donut({ data, center, sub }: { data: { name: string; value: number; color: string }[]; center: string; sub: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty text="No data in this period" />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={74} paddingAngle={2} stroke="none">
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{center}</span>
          <span className="text-[11px] text-slate-400">{sub}</span>
        </div>
      </div>
      <ul className="min-w-[140px] flex-1 space-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="tabular-nums text-slate-800 dark:text-slate-100">
              {d.value} <span className="text-xs text-slate-400">{Math.round((d.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotConnected({ what, msg, className = '' }: { what: string; msg: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 ${className}`}>
      <p className="font-semibold">{what} is not connected yet</p>
      <p className="mt-1 opacity-80">{msg}</p>
      <p className="mt-1 opacity-70">Fix the table or column names in SCHEMA at the top of this file.</p>
    </div>
  );
}

const axisProps = { tick: { fontSize: 11, fill: '#94a3b8' }, axisLine: false, tickLine: false } as const;

/* ------------------------------------------------------------------- page */
export default function FirmReportsPage() {
  const { effectiveUserId } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [role, setRole] = useState('employee');
  const [period, setPeriod] = useState<Period>('daily');
  const [selectedFirmId, setSelectedFirmId] = useState<'all' | string>('all');
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'employees' | 'tasks' | 'att' | 'leave'>('name');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [showAllStaff, setShowAllStaff] = useState(false);
  // Report date: '' means today. Compare mode uses the from/to dates instead of the period tabs.
  const [anchorDate, setAnchorDate] = useState('');
  const [compareOn, setCompareOn] = useState(false);
  const [compareFrom, setCompareFrom] = useState('');
  const [compareTo, setCompareTo] = useState('');

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('user_profiles').select('role').eq('id', effectiveUserId).single().then(({ data }: any) => {
      if (data?.role) setRole(data.role);
    });
  }, [effectiveUserId, supabase]);

  const isDirector = role === 'director';

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setSource(await loadAll(supabase)); }
    catch (e: any) { setError(e?.message ?? 'Could not load the report'); }
    finally { setLoading(false); }
  }, [supabase]);

  // data is loaded once per visit; the period switch is computed in the browser
  useEffect(() => { if (isDirector) loadReport(); }, [isDirector, loadReport]);

  const src = source ?? EMPTY;

  const report = useMemo(() => {
    const { firms, tasks, attendance, leaves, employees, todayNum } = src;
    const now = dateOfNum(todayNum);
    // Report range. Default opens on today. Daily = the chosen day, weekly = 7 days ending on it,
    // monthly = the calendar month containing it (up to today).
    // Compare mode: the picked from→to range, compared with the same number of days before it.
    let startNum: number;
    let endNum: number;
    if (compareOn && compareFrom && compareTo) {
      startNum = numOfYmd(compareFrom);
      endNum = Math.min(numOfYmd(compareTo), todayNum);
    } else {
      const anchor = Math.min(anchorDate ? numOfYmd(anchorDate) : todayNum, todayNum);
      const a = dateOfNum(anchor);
      if (period === 'daily') {
        startNum = anchor; endNum = anchor;
      } else if (period === 'weekly') {
        startNum = anchor - 6; endNum = anchor;
      } else {
        startNum = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / 86400000;
        endNum = Math.min(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0) / 86400000, todayNum);
      }
    }
    const len = Math.max(1, endNum - startNum + 1);
    const prevStart = startNum - len;
    const prevEnd = startNum - 1;
    const inCur = (d: number) => d >= startNum && d <= endNum;
    const inPrev = (d: number) => d >= prevStart && d <= prevEnd;
    const pass = (f: string) => selectedFirmId === 'all' || f === selectedFirmId;

    const agg = (range: (d: number) => boolean, firmPass: (f: string) => boolean) => {
      const t = tasks.filter((r) => firmPass(r.firm) && range(r.day));
      const a = attendance.filter((r) => firmPass(r.firm) && range(r.day));
      const l = leaves.filter((r) => firmPass(r.firm) && range(r.day));
      const done = t.filter((r) => r.status === 'done').length;
      const present = a.filter((r) => PRESENT_LIKE.includes(r.status)).length;
      return { tasksTotal: t.length, tasksDone: done, attTotal: a.length, attPresent: present, leave: l.length, taskRows: t, attRows: a };
    };

    const cur = agg(inCur, pass);
    const prev = agg(inPrev, pass);
    const empF = employees.filter((e) => pass(e.firm));

    // firm rows (always all firms, so the comparison and table stay visible)
    const firmIds = [...firms.map((f) => f.id)];
    const hasUnassigned = [...tasks, ...attendance, ...leaves].some((r) => r.firm === UNASSIGNED) || employees.some((e) => e.firm === UNASSIGNED);
    if (hasUnassigned) firmIds.push(UNASSIGNED);
    const nameOf = (id: string) => (id === UNASSIGNED ? 'Unassigned' : firms.find((f) => f.id === id)?.name ?? '—');
    const codeOf = (id: string) => (id === UNASSIGNED ? '' : firms.find((f) => f.id === id)?.code ?? '');
    const firmRows = firmIds.map((id) => {
      const m = agg(inCur, (f) => f === id);
      return {
        id, name: nameOf(id), code: codeOf(id),
        employees: employees.filter((e) => e.firm === id).length,
        tasksDone: m.tasksDone, tasksTotal: m.tasksTotal, taskRate: pct(m.tasksDone, m.tasksTotal),
        attPresent: m.attPresent, attTotal: m.attTotal, attRate: pct(m.attPresent, m.attTotal),
        leave: m.leave,
      };
    });
    const combined = firmRows.reduce((s, r) => ({
      employees: s.employees + r.employees, tasksDone: s.tasksDone + r.tasksDone, tasksTotal: s.tasksTotal + r.tasksTotal,
      attPresent: s.attPresent + r.attPresent, attTotal: s.attTotal + r.attTotal, leave: s.leave + r.leave,
    }), { employees: 0, tasksDone: 0, tasksTotal: 0, attPresent: 0, attTotal: 0, leave: 0 });

    // status mixes
    const countBy = (rows: Rec[]) => { const m = new Map<string, number>(); rows.forEach((r) => m.set(r.status || 'unknown', (m.get(r.status || 'unknown') ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const attMix = countBy(cur.attRows).map(([k, v], i) => ({ key: k, name: label(k), value: v, color: colorFor(k, i) }));
    const taskMix = countBy(cur.taskRows).map(([k, v], i) => ({ key: k, name: label(k), value: v, color: colorFor(k, i) }));
    const roleMix = (() => { const m = new Map<string, number>(); empF.forEach((e) => m.set(e.role, (m.get(e.role) ?? 0) + 1)); return [...m.entries()].map(([k, v], i) => ({ name: label(k), value: v, color: PALETTE[i % PALETTE.length] })); })();

    // 30 day trends
    const attKeys = [...new Set(attendance.filter((r) => pass(r.firm)).map((r) => r.status || 'unknown'))]
      .sort((a, b) => (PRESENT_LIKE.includes(b) ? 1 : 0) - (PRESENT_LIKE.includes(a) ? 1 : 0) || a.localeCompare(b));
    // Charts follow the selected range: at least 7 days, at most 31, ending on the range's last day.
    const tStart = Math.max(Math.min(startNum, endNum - 6), endNum - 30);
    const tLen = endNum - tStart + 1;
    const trend = Array.from({ length: tLen }, (_, i) => {
      const d = tStart + i;
      const row: any = { label: fmtNum(d), created: 0, done: 0, leave: 0, rate: 0, exp: 0 };
      attKeys.forEach((k) => { row[k] = 0; });
      let tot = 0; let pres = 0;
      attendance.forEach((r) => { if (r.day === d && pass(r.firm)) { row[r.status || 'unknown']++; tot++; if (PRESENT_LIKE.includes(r.status)) pres++; } });
      tasks.forEach((r) => { if (r.day === d && pass(r.firm)) { row.created++; if (r.status === 'done') row.done++; } });
      leaves.forEach((r) => { if (r.day === d && pass(r.firm)) row.leave++; });
      src.expenses.forEach((x) => { if (x.day === d && pass(x.firm)) row.exp += x.amount; });
      row.rate = pct(pres, tot);
      return row;
    });

    // firm x weekday attendance matrix (last 30 days)
    const wk = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dowIdx = (n: number) => (dateOfNum(n).getUTCDay() + 6) % 7;
    const heat = firmIds.map((id) => {
      const cells = wk.map((_, w) => {
        const rs = attendance.filter((r) => r.firm === id && r.day >= tStart && r.day <= endNum && dowIdx(r.day) === w);
        return rs.length ? pct(rs.filter((r) => PRESENT_LIKE.includes(r.status)).length, rs.length) : null;
      });
      return { id, name: nameOf(id), cells };
    });

    // payroll: last 6 months, follows the firm filter
    const monthKeys = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1)).toISOString().slice(0, 7));
    const monthName = (k: string) => new Date(k + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
    const payF = src.payroll.filter((p) => pass(p.firm));
    const isPending = (st: string) => /pending|draft|review|submitted/.test(st);
    const payMonths = monthKeys.map((key) => {
      const rows = payF.filter((p) => p.key === key);
      const sum = (f: (p: PayRec) => number) => rows.reduce((t, p) => t + f(p), 0);
      return { key, month: monthName(key), Gross: sum((p) => p.gross), Net: sum((p) => p.net), Deductions: sum((p) => p.deducted), Absent: sum((p) => p.absent), Present: sum((p) => p.present), slips: rows.length, pending: rows.filter((p) => isPending(p.status)).length };
    });
    const latestIdx = (() => { for (let i = 5; i >= 0; i--) if (payMonths[i].slips > 0) return i; return 5; })();
    const payLatest = payMonths[latestIdx];
    const payPrev = latestIdx > 0 ? payMonths[latestIdx - 1] : null;
    const payStatusMap = new Map<string, number>();
    payF.filter((p) => p.key === payLatest.key).forEach((p) => payStatusMap.set(p.status || 'unknown', (payStatusMap.get(p.status || 'unknown') ?? 0) + 1));
    const payStatus = [...payStatusMap.entries()].map(([k, v], i) => ({ name: label(k), value: v, color: colorFor(k, i) }));
    const payByFirm = firmIds.map((id) => {
      const rows = src.payroll.filter((p) => p.firm === id && p.key === payLatest.key);
      return { id, name: nameOf(id), Gross: rows.reduce((t, p) => t + p.gross, 0), Net: rows.reduce((t, p) => t + p.net, 0) };
    });

    // expenses: selected period
    const expCur = src.expenses.filter((x) => pass(x.firm) && inCur(x.day));
    const expPrev = src.expenses.filter((x) => pass(x.firm) && inPrev(x.day));
    const sumA = (rs: ExpRec[]) => rs.reduce((t, x) => t + x.amount, 0);
    const pipeline = (['pending', 'returned', 'approved', 'reimbursed', 'rejected'] as const).map((k) => {
      const rs = expCur.filter((x) => x.status === k);
      return { key: k, name: label(k), count: rs.length, amount: sumA(rs) };
    });
    const catMap = new Map<string, number>();
    expCur.forEach((x) => catMap.set(x.category, (catMap.get(x.category) ?? 0) + x.amount));
    const expM = {
      claimed: sumA(expCur), claimedPrev: sumA(expPrev), reimbursed: expCur.reduce((t, x) => t + x.reimbursed, 0), pipeline,
      cat: [...catMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8),
      byFirm: firmIds.map((id) => {
        const rs = src.expenses.filter((x) => x.firm === id && inCur(x.day));
        return { id, name: nameOf(id), Claimed: sumA(rs), Reimbursed: rs.reduce((t, x) => t + x.reimbursed, 0) };
      }),
    };

    // staff scorecard: selected period, needs-attention first
    const grp = (rs: StaffRec[]) => { const m = new Map<string, StaffRec[]>(); rs.forEach((r) => { if (!inCur(r.day)) return; const a = m.get(r.emp) ?? []; a.push(r); m.set(r.emp, a); }); return m; };
    const attBy = grp(src.staffAtt); const taskBy = grp(src.staffTasks);
    const expBy = new Map<string, number>();
    expCur.forEach((x) => expBy.set(x.emp, (expBy.get(x.emp) ?? 0) + x.amount));
    const staff = empF.map((e) => {
      const a = attBy.get(e.id) ?? []; const t = taskBy.get(e.id) ?? [];
      const present = a.filter((r) => PRESENT_LIKE.includes(r.status)).length;
      return {
        id: e.id, name: src.names[e.id] ?? 'Employee', firm: nameOf(e.firm), attRate: a.length ? pct(present, a.length) : null,
        late: a.filter((r) => r.status.includes('late')).length, absent: a.filter((r) => r.status.includes('absent')).length,
        done: t.filter((r) => r.status === 'done').length, tasks: t.length, claimed: expBy.get(e.id) ?? 0,
      };
    }).sort((a, b) => (b.absent + b.late) - (a.absent + a.late) || (a.attRate ?? 101) - (b.attRate ?? 101));
    const holidaysNext = src.holidays.filter((h) => h.day >= todayNum).sort((a, b) => a.day - b.day).slice(0, 6);

    return {
      cur, prev, empF, firmRows, combined, attMix, taskMix, roleMix, trend, attKeys, heat, wk, len,
      payMonths, payLatest, payPrev, payStatus, payByFirm, expM, staff, holidaysNext,
      rangeLabel: compareOn
        ? `${fmtNum(startNum)} to ${fmtNum(endNum)}, compared with the ${len} days before`
        : startNum === todayNum && endNum === todayNum
          ? 'Today'
          : startNum === endNum
            ? fmtNum(startNum)
            : `${fmtNum(startNum)} to ${fmtNum(endNum)}`,
    };
  }, [src, period, selectedFirmId, anchorDate, compareOn, compareFrom, compareTo]);

  const sortedFirmRows = useMemo(() => {
    const val = (r: (typeof report.firmRows)[number]): any =>
      sortKey === 'name' ? r.name : sortKey === 'employees' ? r.employees : sortKey === 'tasks' ? r.taskRate : sortKey === 'att' ? r.attRate : r.leave;
    return [...report.firmRows].sort((a, b) => {
      const x = val(a); const y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    });
  }, [report, sortKey, sortDir]);

  const setSort = (k: typeof sortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === 'name' ? 1 : -1); }
  };

  const exportCsv = () => {
    const head = ['Firm', 'Code', 'Employees', 'Tasks done', 'Tasks total', 'Task completion %', 'Attendance present', 'Attendance total', 'Attendance %', 'Leave requests'];
    const lines = [head, ...report.firmRows.map((r) => [r.name, r.code, r.employees, r.tasksDone, r.tasksTotal, r.taskRate, r.attPresent, r.attTotal, r.attRate, r.leave])];
    const csv = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `firm-report-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!isDirector) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400 text-sm">
        This report is only available to directors.
      </div>
    );
  }

  const { cur, prev } = report;
  // Date limits: the page only loads the last WINDOW days, so older dates can't be shown.
  const todayYmd = dateOfNum(src.todayNum).toISOString().slice(0, 10);
  const minYmd = dateOfNum(src.todayNum - (WINDOW - 1)).toISOString().slice(0, 10);
  const attRate = pct(cur.attPresent, cur.attTotal);
  const attRatePrev = pct(prev.attPresent, prev.attTotal);
  const taskRate = pct(cur.tasksDone, cur.tasksTotal);
  const taskRatePrev = pct(prev.tasksDone, prev.tasksTotal);
  const selectedName = selectedFirmId === 'all' ? 'All firms' : report.firmRows.find((r) => r.id === selectedFirmId)?.name ?? '—';
  const toggleFirm = (id: string) => setSelectedFirmId((c) => (c === id ? 'all' : id));
  const heatColor = (v: number | null) => (v === null ? 'rgba(148,163,184,0.15)' : `rgba(13,148,136,${0.15 + 0.85 * Math.max(0, Math.min(1, (v - 60) / 40))})`);
  const firmBars = report.firmRows.map((r) => ({ id: r.id, name: r.name, Attendance: r.attRate, 'Task completion': r.taskRate, Employees: r.employees }));

  return (
    <CompareContext.Provider value={compareOn}>
    <div className="max-w-screen-xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp size={22} className="text-blue-600" /> Firm Reports
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">
            {selectedName}. {report.rangeLabel}. View each firm separately or combined.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden text-xs font-semibold" role="group" aria-label="Period">
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} disabled={compareOn}
                className={`px-3.5 py-2 capitalize disabled:opacity-50 ${period === p ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {p}
              </button>
            ))}
          </div>
          <input type="date" aria-label={compareOn ? 'From date' : 'Report date'}
            value={compareOn ? compareFrom : (anchorDate || todayYmd)}
            min={minYmd} max={todayYmd}
            onChange={(e) => (compareOn ? setCompareFrom(e.target.value) : setAnchorDate(e.target.value === todayYmd ? '' : e.target.value))}
            className="border border-slate-200 dark:border-slate-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200" />
          {compareOn && (
            <input type="date" aria-label="To date" value={compareTo}
              min={compareFrom || minYmd} max={todayYmd}
              onChange={(e) => setCompareTo(e.target.value)}
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200" />
          )}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={compareOn}
              onChange={(e) => {
                const on = e.target.checked;
                setCompareOn(on);
                if (on) {
                  if (!compareFrom) setCompareFrom(dateOfNum(src.todayNum - 6).toISOString().slice(0, 10));
                  if (!compareTo) setCompareTo(todayYmd);
                }
              }} />
            Compare dates
          </label>
          {compareOn && compareFrom && compareTo && compareFrom > compareTo && (
            <span className="text-xs text-rose-600">From date must be before To date</span>
          )}
          <button onClick={loadReport} disabled={loading} aria-label="Refresh" className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-2 text-slate-600 dark:text-slate-300 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportCsv} aria-label="Export CSV" className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-2 text-slate-600 dark:text-slate-300"><Download size={14} /></button>
          <button onClick={() => window.print()} aria-label="Print" className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-2 text-slate-600 dark:text-slate-300"><Printer size={14} /></button>
        </div>
      </div>

      {/* firm tabs */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1 print:hidden">
        <button
          onClick={() => setSelectedFirmId('all')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border ${selectedFirmId === 'all' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
        >
          <Layers size={13} /> All Firms (Combined)
        </button>
        {report.firmRows.map((f) => (
          <button
            key={f.id}
            onClick={() => setSelectedFirmId(f.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border ${selectedFirmId === f.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
          >
            <Building2 size={13} /> {f.name}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          Could not load the report: {error}
        </div>
      )}

      {loading && !source ? (
        <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={<Users size={13} />} name="Active Employees" value={report.empF.length} sub={`${report.roleMix.map((r) => `${r.value} ${r.name.toLowerCase()}`).join(', ') || 'No employees'}`} color={C.indigo} />
            <Kpi icon={<CheckSquare size={13} />} name="Tasks Completed" value={<>{cur.tasksDone}<span className="text-sm text-slate-400 font-medium">/{cur.tasksTotal}</span></>} sub={`${taskRate}% completion`} delta={<Delta value={taskRate - taskRatePrev} suffix=" pts" />} spark={report.trend.map((t: any) => t.done)} color={C.teal} />
            <Kpi icon={<CheckSquare size={13} />} name="Tasks Still Open" value={cur.tasksTotal - cur.tasksDone} sub="Created this period, not done" delta={<Delta value={(cur.tasksTotal - cur.tasksDone) - (prev.tasksTotal - prev.tasksDone)} goodWhenUp={false} />} color={C.amber} />
            <Kpi icon={<Clock size={13} />} name="Attendance" value={`${attRate}%`} sub={`${cur.attPresent}/${cur.attTotal} present`} delta={<Delta value={attRate - attRatePrev} suffix=" pts" />} spark={report.trend.map((t: any) => t.rate)} color={C.teal} />
            <Kpi icon={<Clock size={13} />} name="Not Present" value={cur.attTotal - cur.attPresent} sub="Absent, leave and other statuses" delta={<Delta value={(cur.attTotal - cur.attPresent) - (prev.attTotal - prev.attPresent)} goodWhenUp={false} />} color={C.rose} />
            <Kpi icon={<Calendar size={13} />} name="Leave Requests" value={cur.leave} delta={<Delta value={cur.leave - prev.leave} neutral />} spark={report.trend.map((t: any) => t.leave)} color={C.violet} />
          </div>

          {/* payroll and expense KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {src.warn.payroll ? (
              <NotConnected what="Payroll" msg={src.warn.payroll} className="col-span-2 lg:col-span-3" />
            ) : (
              <>
                <Kpi icon={<Wallet size={13} />} name={`Net Payroll (${report.payLatest.month})`} value={'₹' + compact(report.payLatest.Net)} sub={`${report.payLatest.slips} payslips`} delta={report.payPrev ? <Delta value={chg(report.payLatest.Net, report.payPrev.Net)} suffix="%" /> : undefined} spark={report.payMonths.map((m) => m.Net)} color={C.indigo} />
                <Kpi icon={<Wallet size={13} />} name="Absence Deductions" value={inr(report.payLatest.Deductions)} sub={`${report.payLatest.Absent} absent days in ${report.payLatest.month}`} delta={report.payPrev ? <Delta value={chg(report.payLatest.Deductions, report.payPrev.Deductions)} suffix="%" goodWhenUp={false} /> : undefined} color={C.rose} />
                <Kpi icon={<Wallet size={13} />} name="Payslips To Approve" value={report.payLatest.pending} sub={`${report.payLatest.month} payroll`} color={C.amber} />
              </>
            )}
            {src.warn.expenses ? (
              <NotConnected what="Expenses" msg={src.warn.expenses} className="col-span-2 lg:col-span-3" />
            ) : (
              <>
                <Kpi icon={<Receipt size={13} />} name="Expenses Claimed" value={inr(report.expM.claimed)} sub={report.rangeLabel} delta={<Delta value={chg(report.expM.claimed, report.expM.claimedPrev)} suffix="%" neutral />} spark={report.trend.map((t: any) => t.exp)} color={C.amber} />
                <Kpi icon={<Receipt size={13} />} name="Awaiting Approval" value={inr(report.expM.pipeline[0].amount)} sub={`${report.expM.pipeline[0].count} requests, ${report.expM.pipeline[1].count} returned for clarification`} color={C.rose} />
                <Kpi icon={<Receipt size={13} />} name="Reimbursed" value={inr(report.expM.reimbursed)} sub={`${pct(report.expM.reimbursed, report.expM.claimed)}% of claimed`} color={C.teal} />
              </>
            )}
          </div>

          {/* attendance trend + mix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Tile className="lg:col-span-8" title="Attendance by day" hint={`Records per day by status · ${report.rangeLabel}`}>
              <div className="h-64">
                {report.attKeys.length === 0 ? <Empty text="No attendance records yet" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} minTickGap={28} />
                      <YAxis {...axisProps} allowDecimals={false} />
                      <Tooltip content={<ChartTip />} />
                      {report.attKeys.map((k, i) => (
                        <Area key={k} type="monotone" dataKey={k} name={label(k)} stackId="a" stroke={colorFor(k, i)} fill={colorFor(k, i)} fillOpacity={0.85} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Tile>
            <Tile className="lg:col-span-4" title="Attendance mix" hint={report.rangeLabel}>
              <Donut data={report.attMix} center={`${attRate}%`} sub="present" />
            </Tile>
          </div>

          {/* tasks trend + mix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Tile className="lg:col-span-8" title="Tasks by day" hint={`Created each day and how many are done · ${report.rangeLabel}`}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={report.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} minTickGap={28} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="created" name="Created" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="done" name="Done" stroke={C.teal} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Tile>
            <Tile className="lg:col-span-4" title="Task status" hint={report.rangeLabel}>
              <Donut data={report.taskMix} center={`${taskRate}%`} sub="done" />
            </Tile>
          </div>

          {/* firm comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Tile className="lg:col-span-5" title="Firm comparison" hint="Click a bar to filter the report">
              <div className="h-64">
                {firmBars.length === 0 ? <Empty text="No firms yet" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={firmBars} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis {...axisProps} domain={[0, 100]} />
                      <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Attendance" fill={C.teal} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)}>
                        {firmBars.map((f) => <Cell key={f.id} fill={C.teal} fillOpacity={selectedFirmId === 'all' || selectedFirmId === f.id ? 1 : 0.25} />)}
                        <LabelList dataKey="Attendance" position="top" formatter={(v: any) => `${v}%`} style={{ fontSize: 10, fill: '#94a3b8' }} />
                      </Bar>
                      <Bar dataKey="Task completion" fill={C.indigo} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)}>
                        {firmBars.map((f) => <Cell key={f.id} fill={C.indigo} fillOpacity={selectedFirmId === 'all' || selectedFirmId === f.id ? 1 : 0.25} />)}
                        <LabelList dataKey="Task completion" position="top" formatter={(v: any) => `${v}%`} style={{ fontSize: 10, fill: '#94a3b8' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Tile>
            <Tile className="lg:col-span-3" title="Employees per firm">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={firmBars} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} horizontal={false} />
                    <XAxis type="number" {...axisProps} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={80} {...axisProps} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Bar dataKey="Employees" fill={C.violet} radius={[0, 3, 3, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)}>
                      {firmBars.map((f) => <Cell key={f.id} fill={C.violet} fillOpacity={selectedFirmId === 'all' || selectedFirmId === f.id ? 1 : 0.25} />)}
                      <LabelList dataKey="Employees" position="right" style={{ fontSize: 11, fill: '#94a3b8' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Tile>
            <Tile className="lg:col-span-4" title="Roles" hint="Active employees in this selection">
              <Donut data={report.roleMix} center={String(report.empF.length)} sub="people" />
            </Tile>
          </div>

          {/* heatmap + leave */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Tile className="lg:col-span-5" title="Attendance by weekday" hint={`Present rate per firm · ${report.rangeLabel}`}>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-1 text-[11px] text-slate-400">
                  <thead>
                    <tr><th />{report.wk.map((w) => <th key={w} className="font-medium">{w}</th>)}</tr>
                  </thead>
                  <tbody>
                    {report.heat.map((r) => (
                      <tr key={r.id} className={selectedFirmId === 'all' || selectedFirmId === r.id ? '' : 'opacity-40'}>
                        <td className="pr-2 text-right text-slate-500 dark:text-slate-300 whitespace-nowrap">{r.name}</td>
                        {r.cells.map((v, i) => (
                          <td key={i} title={v === null ? 'No data' : `${r.name}, ${report.wk[i]}: ${v}%`} className="h-8 min-w-[34px] rounded-md text-center align-middle text-slate-800 dark:text-slate-100" style={{ background: heatColor(v) }}>
                            {v === null ? '' : `${v}%`}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tile>
            <Tile className="lg:col-span-7" title="Leave requests by day" hint={`Requests raised per day · ${report.rangeLabel}`}>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} minTickGap={28} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Bar dataKey="leave" name="Leave requests" fill={C.violet} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Tile>
          </div>

          {/* payroll */}
          {!src.warn.payroll && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Tile className="lg:col-span-8" title="Payroll, last 6 months" hint="Gross, net paid and absence deductions per month">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={report.payMonths} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="month" {...axisProps} />
                        <YAxis yAxisId="l" {...axisProps} tickFormatter={(v) => compact(v)} />
                        <YAxis yAxisId="r" orientation="right" {...axisProps} tickFormatter={(v) => compact(v)} />
                        <Tooltip content={<ChartTip money />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="l" dataKey="Gross" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                        <Bar yAxisId="l" dataKey="Net" name="Net paid" fill={C.indigo} radius={[3, 3, 0, 0]} />
                        <Line yAxisId="r" type="monotone" dataKey="Deductions" stroke={C.rose} strokeWidth={2} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Tile>
                <Tile className="lg:col-span-4" title={`Payslips, ${report.payLatest.month}`} hint="Status of the latest payroll run">
                  <Donut data={report.payStatus} center={String(report.payLatest.slips)} sub="payslips" />
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-700/40"><dt className="text-slate-400">Days present (with paid leave)</dt><dd className="font-semibold text-slate-800 dark:text-slate-100">{report.payLatest.Present}</dd></div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-700/40"><dt className="text-slate-400">Days absent</dt><dd className="font-semibold text-slate-800 dark:text-slate-100">{report.payLatest.Absent}</dd></div>
                  </dl>
                </Tile>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Tile title="Payroll by firm" hint={`Gross and net for ${report.payLatest.month}. Click a bar to filter.`}>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.payByFirm} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="name" {...axisProps} />
                        <YAxis {...axisProps} tickFormatter={(v) => compact(v)} />
                        <Tooltip content={<ChartTip money />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Gross" fill="#c7d2fe" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)} />
                        <Bar dataKey="Net" fill={C.indigo} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tile>
                <Tile title="Absent days by month" hint="Days that fed the deductions above">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.payMonths} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="month" {...axisProps} />
                        <YAxis {...axisProps} allowDecimals={false} />
                        <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                        <Bar dataKey="Absent" name="Absent days" fill={C.rose} radius={[3, 3, 0, 0]}>
                          <LabelList dataKey="Absent" position="top" style={{ fontSize: 11, fill: '#94a3b8' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tile>
              </div>
            </>
          )}

          {/* expenses */}
          {!src.warn.expenses && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <Tile className="lg:col-span-8" title="Expenses by day" hint={`Amount claimed per day · ${report.rangeLabel}`}>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} minTickGap={28} />
                        <YAxis {...axisProps} tickFormatter={(v) => compact(v)} />
                        <Tooltip content={<ChartTip money />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                        <Bar dataKey="exp" name="Claimed" fill={C.amber} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tile>
                <Tile className="lg:col-span-4" title="Approval pipeline" hint={report.rangeLabel}>
                  <ul className="space-y-3 text-sm">
                    {report.expM.pipeline.map((p, i) => (
                      <li key={p.key}>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>{p.name} <span className="text-xs text-slate-400">({p.count})</span></span>
                          <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{inr(p.amount)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                          <div className="h-full rounded-full" style={{ width: `${pct(p.amount, report.expM.claimed)}%`, background: colorFor(p.key === 'returned' ? 'overdue' : p.key === 'pending' ? 'pending' : p.key === 'rejected' ? 'absent' : 'present', i) }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Tile>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Tile title="Expenses by category" hint={report.rangeLabel}>
                  <div className="h-56">
                    {report.expM.cat.length === 0 ? <Empty text="No expenses in this period" /> : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={report.expM.cat} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid stroke={C.grid} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => compact(v)} />
                          <YAxis type="category" dataKey="category" width={90} {...axisProps} />
                          <Tooltip content={<ChartTip money />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                          <Bar dataKey="amount" name="Amount" fill={C.amber} radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Tile>
                <Tile title="Expenses by firm" hint="Claimed against reimbursed. Click a bar to filter.">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.expM.byFirm} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="name" {...axisProps} />
                        <YAxis {...axisProps} tickFormatter={(v) => compact(v)} />
                        <Tooltip content={<ChartTip money />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Claimed" fill={C.amber} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)} />
                        <Bar dataKey="Reimbursed" fill={C.teal} radius={[3, 3, 0, 0]} cursor="pointer" onClick={(d: any) => toggleFirm(d.id)} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tile>
              </div>
            </>
          )}

          {/* staff scorecard + holidays */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {src.warn.staff ? (
              <NotConnected what="Employee scorecard" msg={src.warn.staff} className="lg:col-span-8" />
            ) : (
              <Tile
                className="lg:col-span-8"
                title="Employee scorecard"
                hint="People with the most late or absent days come first"
                right={<button onClick={() => setShowAllStaff((v) => !v)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 print:hidden">{showAllStaff ? 'Show top 8' : `Show all ${report.staff.length}`}</button>}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-700">
                        <th className="py-2 pr-3">Employee</th><th className="py-2 pr-3">Attendance</th><th className="py-2 pr-3">Late</th><th className="py-2 pr-3">Absent</th><th className="py-2 pr-3">Tasks</th><th className="py-2 pr-3">Expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllStaff ? report.staff : report.staff.slice(0, 8)).map((r) => (
                        <tr key={r.id} className="border-b border-slate-50 last:border-0 dark:border-slate-700/50">
                          <td className="py-2 pr-3"><div className="font-semibold text-slate-700 dark:text-slate-200">{r.name}</div><div className="text-[11px] text-slate-400">{r.firm}</div></td>
                          <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-300">{r.attRate === null ? '—' : `${r.attRate}%`}</td>
                          <td className={`py-2 pr-3 tabular-nums ${r.late ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{r.late}</td>
                          <td className={`py-2 pr-3 tabular-nums ${r.absent ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>{r.absent}</td>
                          <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-300">{r.done}/{r.tasks}</td>
                          <td className="py-2 pr-3 tabular-nums text-slate-600 dark:text-slate-300">{r.claimed ? inr(r.claimed) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Tile>
            )}
            {src.warn.holidays ? (
              <NotConnected what="Holidays" msg={src.warn.holidays} className="lg:col-span-4" />
            ) : (
              <Tile className="lg:col-span-4" title="Upcoming holidays" hint="Nobody is auto-marked absent on these days">
                {report.holidaysNext.length === 0 ? <Empty text="No upcoming holidays" /> : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                    {report.holidaysNext.map((h) => (
                      <li key={h.day + h.name} className="flex items-center gap-3 py-2.5">
                        <CalendarDays size={15} className="text-blue-600" />
                        <span className="flex-1 text-slate-700 dark:text-slate-200">{h.name}</span>
                        <span className="text-xs text-slate-400">{fmtNum(h.day)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Tile>
            )}
          </div>

          {/* per-firm table */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden print:break-inside-avoid">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
              Per-firm breakdown ({period})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-700">
                    {([['name', 'Firm'], ['employees', 'Employees'], ['tasks', 'Tasks'], ['att', 'Attendance'], ['leave', 'Leave']] as const).map(([k, l]) => (
                      <th key={k} className="px-4 py-2">
                        <button onClick={() => setSort(k)} className="inline-flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200">
                          {l}{sortKey === k && <span aria-hidden>{sortDir === 1 ? '▲' : '▼'}</span>}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFirmRows.map((r) => (
                    <tr key={r.id} className={`border-b border-slate-50 dark:border-slate-700/50 ${r.id === UNASSIGNED ? 'bg-slate-50/50 dark:bg-slate-700/20 italic' : ''} ${selectedFirmId === r.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                        {r.id === UNASSIGNED ? 'Unassigned (no firm set)' : <>{r.name} <span className="text-slate-400 font-normal">({r.code})</span></>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.employees}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${r.taskRate}%` }} /></div>
                          {r.tasksDone}/{r.tasksTotal} <span className="text-slate-400">({r.taskRate}%)</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full" style={{ width: `${r.attRate}%`, background: r.attRate >= 90 ? C.teal : r.attRate >= 75 ? C.amber : C.rose }} /></div>
                          {r.attRate}%
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{r.leave}</td>
                    </tr>
                  ))}
                  <tr className="bg-violet-50 dark:bg-violet-900/20 font-bold">
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">All Firms (Combined)</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{report.combined.employees}</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{report.combined.tasksDone}/{report.combined.tasksTotal} ({pct(report.combined.tasksDone, report.combined.tasksTotal)}%)</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{pct(report.combined.attPresent, report.combined.attTotal)}%</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{report.combined.leave}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
    </CompareContext.Provider>
  );
}
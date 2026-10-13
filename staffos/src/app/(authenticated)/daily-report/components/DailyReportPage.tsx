'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Save, Plus, Trash2, Loader2, BarChart3, Fuel } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Fuel_ { id: string; name: string; price: string; daySales: string; purchase: string; totalStock: string }
interface Nozzle { id: string; fuel: string; opening: string; closing: string; test: string }
interface Tank { id: string; name: string; fuel: string; dip: string; ltr: string }
interface Expense { id: string; particulars: string; amount: string; mode: 'cash' | 'online' }

interface ReportData {
  fuels: Fuel_[];
  nozzles: Nozzle[];
  tanks: Tank[];
  sales: { cash: string; card: string; online: string; credit: string; other: string };
  cashInHand: string;
  expenses: Expense[];
}

type Period = 'week' | 'month' | 'quarter' | 'year';
interface HistoryRow { firm_id: string; report_date: string; data: ReportData }
interface FirmOption { id: string; name: string; code: string | null }
interface DayRow { firm_id: string; updated_by: string | null; updated_at: string | null; data: ReportData }

const ALL = '__all__'; // director-only view across every selected firm

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_FUELS = ['MS', 'HSD', 'POWER', 'TURBO', 'E20', 'XP95'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: 'week', label: 'Weekly', days: 84 },
  { id: 'month', label: 'Monthly', days: 365 },
  { id: 'quarter', label: 'Quarterly', days: 730 },
  { id: 'year', label: 'Annual', days: 1826 },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
  : '';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function emptyReport(): ReportData {
  return {
    fuels: DEFAULT_FUELS.map((name) => ({ id: name.toLowerCase(), name, price: '', daySales: '', purchase: '', totalStock: '' })),
    nozzles: Array.from({ length: 6 }, () => ({ id: uid(), fuel: 'ms', opening: '', closing: '', test: '' })),
    tanks: [
      { id: uid(), name: 'Tank 1', fuel: 'ms', dip: '', ltr: '' },
      { id: uid(), name: 'Tank 2', fuel: 'hsd', dip: '', ltr: '' },
      { id: uid(), name: 'Tank 3', fuel: 'power', dip: '', ltr: '' },
      { id: uid(), name: 'Tank 4', fuel: 'xp95', dip: '', ltr: '' },
    ],
    sales: { cash: '', card: '', online: '', credit: '', other: '' },
    cashInHand: '',
    expenses: [],
  };
}

// Merge a saved row with defaults so older/partial rows still render
function normalize(raw: Partial<ReportData> | null | undefined): ReportData {
  const base = emptyReport();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    fuels: raw.fuels?.length ? raw.fuels : base.fuels,
    nozzles: raw.nozzles ?? base.nozzles,
    tanks: raw.tanks ?? base.tanks,
    sales: { ...base.sales, ...(raw.sales || {}) },
    expenses: raw.expenses ?? [],
  };
}

function summarize(d: ReportData) {
  const fuelSaleAmount = d.fuels.reduce((s, f) => s + num(f.daySales) * num(f.price), 0);
  const litres = d.fuels.reduce((s, f) => s + num(f.daySales), 0);
  const inward = Object.values(d.sales).reduce((s, v) => s + num(v), 0);
  const cashExp = d.expenses.filter((e) => e.mode === 'cash').reduce((s, e) => s + num(e.amount), 0);
  const onlineExp = d.expenses.filter((e) => e.mode === 'online').reduce((s, e) => s + num(e.amount), 0);
  return {
    fuelSaleAmount,
    litres,
    inward,
    difference: fuelSaleAmount - inward,
    cashSale: num(d.sales.cash),
    cashExp,
    onlineExp,
    totalExp: cashExp + onlineExp,
    cashInHand: num(d.cashInHand),
  };
}

// Bucket key sorts correctly as a string: week = Monday's date, month = YYYY-MM, quarter = YYYY-Qn, year = YYYY
function bucketOf(dateStr: string, period: Period): { key: string; label: string } {
  const d = parseYmd(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth();
  if (period === 'week') {
    const monday = addDays(d, -((d.getDay() + 6) % 7));
    return { key: ymd(monday), label: `${monday.getDate()} ${MONTHS[monday.getMonth()]}` };
  }
  if (period === 'month') return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
  if (period === 'quarter') {
    const q = Math.floor(m / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  return { key: `${y}`, label: `${y}` };
}

const inputCls = 'w-full border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-60';
const thCls = 'text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-2 py-2 bg-slate-50 dark:bg-slate-700/50';
const tdCls = 'px-2 py-1.5 align-middle';
const cardCls = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DailyReportPage() {
  const { pinSession, effectiveUserId } = useAuth();
  const supabase = createClient();

  const isDirector = pinSession?.role === 'director';

  const [date, setDate] = useState(() => ymd(new Date()));
  const [firms, setFirms] = useState<FirmOption[]>([]);
  const [firmsLoaded, setFirmsLoaded] = useState(false);
  const [firmId, setFirmId] = useState<string>('');
  const [data, setData] = useState<ReportData>(emptyReport);
  const [meta, setMeta] = useState<{ by: string | null; at: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updaterName, setUpdaterName] = useState('');
  const [dayRows, setDayRows] = useState<DayRow[]>([]);

  const [period, setPeriod] = useState<Period>('month');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isAll = firmId === ALL;
  const firmIds = useMemo(() => firms.map((f) => f.id), [firms]);
  const firmName = isAll ? 'All firms' : (firms.find((f) => f.id === firmId)?.name || '');

  // Firms this user may see: directors → every firm in the daily report;
  // employees → only the firms they are assigned to as editor.
  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { data: selectedRows } = await supabase.from('daily_report_firms').select('firm_id');
      const selected = (selectedRows || []).map((r: { firm_id: string }) => r.firm_id);
      let allowed = selected;
      if (!isDirector) {
        const { data: assignedRows } = await supabase
          .from('daily_report_editors').select('firm_id').eq('user_id', effectiveUserId);
        const mine = new Set((assignedRows || []).map((r: { firm_id: string }) => r.firm_id));
        allowed = selected.filter((id) => mine.has(id));
      }
      if (allowed.length === 0) {
        setFirms([]);
        setFirmId('');
        setFirmsLoaded(true);
        return;
      }
      const { data: list } = await supabase.from('firms').select('id, name, code').in('id', allowed).order('name');
      const options = (list as FirmOption[]) || [];
      setFirms(options);
      setFirmId((cur) => cur || (isDirector && options.length > 1 ? ALL : options[0]?.id || ''));
      setFirmsLoaded(true);
    })();
  }, [effectiveUserId, isDirector]);

  // Name of the person entering data (shown as "updated by")
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('user_profiles').select('full_name').eq('id', effectiveUserId).maybeSingle()
      .then(({ data: p }) => setUpdaterName(p?.full_name || 'Unknown'));
  }, [effectiveUserId]);

  // Load one firm's report for the selected day
  useEffect(() => {
    if (!firmId || isAll) return;
    setLoading(true);
    supabase.from('daily_station_reports')
      .select('data, updated_by, updated_at')
      .eq('firm_id', firmId)
      .eq('report_date', date)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error) toast.error('Could not load report');
        setData(normalize(row?.data as ReportData | undefined));
        setMeta(row ? { by: row.updated_by, at: row.updated_at } : null);
        setLoading(false);
      });
  }, [date, firmId]);

  // All-firms view: every selected firm's report for the day
  useEffect(() => {
    if (!isAll || firmIds.length === 0) return;
    setLoading(true);
    supabase.from('daily_station_reports')
      .select('firm_id, data, updated_by, updated_at')
      .in('firm_id', firmIds)
      .eq('report_date', date)
      .then(({ data: rows, error }) => {
        if (error) toast.error('Could not load reports');
        setDayRows((rows as DayRow[]) || []);
        setLoading(false);
      });
  }, [date, firmId, firmIds.join(',')]);

  // Trend for the chosen firm, or all firms together
  const loadHistory = useCallback(async () => {
    if (!firmId || firmIds.length === 0) return;
    setHistoryLoading(true);
    const days = PERIODS.find((p) => p.id === period)?.days ?? 365;
    const from = ymd(addDays(new Date(), -days));
    let q = supabase.from('daily_station_reports').select('firm_id, report_date, data').gte('report_date', from);
    q = isAll ? q.in('firm_id', firmIds) : q.eq('firm_id', firmId);
    const { data: rows, error } = await q.order('report_date', { ascending: true });
    if (error) toast.error('Could not load trend');
    setHistory((rows as HistoryRow[]) || []);
    setHistoryLoading(false);
  }, [period, firmId, firmIds.join(',')]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const totals = useMemo(() => summarize(data), [data]);

  const chartData = useMemo(() => {
    type G = { key: string; label: string; sales: number; expenses: number; litres: number; cashByDate: Map<string, number> };
    const groups = new Map<string, G>();
    history.forEach((row) => {
      const { key, label } = bucketOf(row.report_date, period);
      const s = summarize(normalize(row.data));
      const g: G = groups.get(key) || { key, label, sales: 0, expenses: 0, litres: 0, cashByDate: new Map() };
      g.sales += s.fuelSaleAmount;
      g.expenses += s.totalExp;
      g.litres += s.litres;
      // Closing cash = cash in hand on the latest day in the bucket (summed across firms in all-firms view)
      g.cashByDate.set(row.report_date, (g.cashByDate.get(row.report_date) || 0) + s.cashInHand);
      groups.set(key, g);
    });
    return Array.from(groups.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => {
        const latest = Array.from(g.cashByDate.keys()).sort().pop();
        return {
          key: g.key,
          label: g.label,
          sales: g.sales,
          expenses: g.expenses,
          cashInHand: latest ? g.cashByDate.get(latest) || 0 : 0,
        };
      });
  }, [history, period]);

  // ----- Save (single firm only) -----
  const save = async () => {
    if (!firmId || isAll) { toast.error('Choose a single firm to save its report'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('daily_station_reports')
      .upsert(
        { firm_id: firmId, report_date: date, data, updated_by: updaterName || null },
        { onConflict: 'firm_id,report_date' },
      );
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    setMeta({ by: updaterName || null, at: new Date().toISOString() });
    toast.success('Daily report saved');
    loadHistory();
  };

  // ----- Updaters -----
  const setFuel = (id: string, patch: Partial<Fuel_>) =>
    setData((d) => ({ ...d, fuels: d.fuels.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const setNozzle = (id: string, patch: Partial<Nozzle>) =>
    setData((d) => ({ ...d, nozzles: d.nozzles.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const setTank = (id: string, patch: Partial<Tank>) =>
    setData((d) => ({ ...d, tanks: d.tanks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const setExpense = (id: string, patch: Partial<Expense>) =>
    setData((d) => ({ ...d, expenses: d.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const fuelOptions = data.fuels.map((f) => <option key={f.id} value={f.id}>{f.name || '—'}</option>);

  // ----- Empty / loading states -----
  if (!firmsLoaded) {
    return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-blue-500" /></div>;
  }

  if (firms.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className={cardCls + ' p-8 text-center'}>
          <Fuel size={32} className="mx-auto text-slate-300 mb-3" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">No firm assigned</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isDirector
              ? 'No firms are in the daily report yet. Add firms under Director Settings → Fuel Station Daily Report.'
              : 'You have not been assigned to any firm\'s daily report. Ask a director to assign you under Director Settings.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Daily Report{firmName ? <span className="text-blue-600 dark:text-blue-400"> · {firmName}</span> : null}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isAll
              ? 'Every firm in the daily report, for the selected day and trend (view only; pick a firm to edit)'
              : 'Fuel stock, tank dips, sales, cash in hand and expenses for the day'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Firm</label>
            <select value={firmId} onChange={(e) => setFirmId(e.target.value)} className={inputCls + ' w-56'}>
              {isDirector && firms.length > 1 && <option value={ALL}>All firms (view)</option>}
              {firms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.code ? ` (${f.code})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
              className={inputCls + ' w-44'} />
          </div>
          {!isAll && (
            <button onClick={save} disabled={saving || loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? 'Saving…' : 'Save Report'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-500" /></div>
      ) : isAll ? (
        // ---------- All firms (director view) ----------
        <div className={cardCls}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Firms on {date}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr>{['Firm', 'Sale (fuel)', 'Litres', 'Cash sale', 'Cash in hand', 'Expenses', 'Last updated'].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {firms.map((f) => {
                  const row = dayRows.find((r) => r.firm_id === f.id);
                  if (!row) {
                    return (
                      <tr key={f.id}>
                        <td className={tdCls + ' font-semibold'}>{f.name}</td>
                        <td colSpan={6} className={tdCls + ' text-slate-400 italic'}>No report saved for this day</td>
                      </tr>
                    );
                  }
                  const s = summarize(normalize(row.data));
                  return (
                    <tr key={f.id}>
                      <td className={tdCls + ' font-semibold'}>{f.name}</td>
                      <td className={tdCls + ' text-right tabular-nums'}>{fmtMoney(s.fuelSaleAmount)}</td>
                      <td className={tdCls + ' text-right tabular-nums'}>{fmtNum(s.litres)}</td>
                      <td className={tdCls + ' text-right tabular-nums'}>{fmtMoney(s.cashSale)}</td>
                      <td className={tdCls + ' text-right tabular-nums'}>{fmtMoney(s.cashInHand)}</td>
                      <td className={tdCls + ' text-right tabular-nums'}>{fmtMoney(s.totalExp)}</td>
                      <td className={tdCls + ' text-xs text-slate-500'}>{row.updated_by || '—'}{row.updated_at ? ` · ${fmtTime(row.updated_at)}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // ---------- Single firm: entry ----------
        <>
          {meta?.at && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Last updated by <span className="font-semibold">{meta.by || 'Unknown'}</span> on {fmtTime(meta.at)}
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Sale Today (fuel)', value: fmtMoney(totals.fuelSaleAmount), sub: `${fmtNum(totals.litres)} L sold` },
              { label: 'Cash Sale Today', value: fmtMoney(totals.cashSale), sub: 'Cash counter' },
              { label: 'Total Cash in Hand', value: fmtMoney(totals.cashInHand), sub: 'End of day' },
              { label: 'Expenses Today', value: fmtMoney(totals.totalExp), sub: `Cash ${fmtMoney(totals.cashExp)} · Online ${fmtMoney(totals.onlineExp)}` },
            ].map((t) => (
              <div key={t.label} className={cardCls + ' p-4'}>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t.label}</p>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">{t.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{t.sub}</p>
              </div>
            ))}
          </div>

          {/* Fuel stock & sales */}
          <div className={cardCls}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Stock Report by Fuel</h2>
                <p className="text-[11px] text-slate-500">You can rename a fuel; tanks and nozzles pick it from this list.</p>
              </div>
              <button onClick={() => setData((d) => ({ ...d, fuels: [...d.fuels, { id: uid(), name: 'NEW FUEL', price: '', daySales: '', purchase: '', totalStock: '' }] }))}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"><Plus size={13} /> Add fuel</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr>
                    {['Fuel', 'Price (₹/L)', 'Day sales (L)', 'Sale amount', 'Purchase (L)', 'Total stock (L)', 'Day +/- (L)'].map((h) => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.fuels.map((f) => (
                    <tr key={f.id}>
                      <td className={tdCls}><input className={inputCls + ' font-semibold'} value={f.name} onChange={(e) => setFuel(f.id, { name: e.target.value })} /></td>
                      <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={f.price} onChange={(e) => setFuel(f.id, { price: e.target.value })} /></td>
                      <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={f.daySales} onChange={(e) => setFuel(f.id, { daySales: e.target.value })} /></td>
                      <td className={tdCls + ' text-right tabular-nums font-semibold'}>{fmtMoney(num(f.daySales) * num(f.price))}</td>
                      <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={f.purchase} onChange={(e) => setFuel(f.id, { purchase: e.target.value })} /></td>
                      <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={f.totalStock} onChange={(e) => setFuel(f.id, { totalStock: e.target.value })} /></td>
                      <td className={tdCls + ' text-right tabular-nums ' + (num(f.purchase) - num(f.daySales) < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmtNum(num(f.purchase) - num(f.daySales))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 dark:bg-slate-700/50 font-semibold">
                    <td className={tdCls}>Total</td>
                    <td className={tdCls} />
                    <td className={tdCls + ' tabular-nums'}>{fmtNum(totals.litres)}</td>
                    <td className={tdCls + ' text-right tabular-nums'}>{fmtMoney(totals.fuelSaleAmount)}</td>
                    <td className={tdCls + ' tabular-nums'}>{fmtNum(data.fuels.reduce((s, f) => s + num(f.purchase), 0))}</td>
                    <td className={tdCls + ' tabular-nums'}>{fmtNum(data.fuels.reduce((s, f) => s + num(f.totalStock), 0))}</td>
                    <td className={tdCls} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Nozzle meters */}
            <div className={cardCls}>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Nozzle Meter Readings</h2>
                <button onClick={() => setData((d) => ({ ...d, nozzles: [...d.nozzles, { id: uid(), fuel: d.fuels[0]?.id || 'ms', opening: '', closing: '', test: '' }] }))}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"><Plus size={13} /> Add nozzle</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr>
                      {['#', 'Fuel', 'Opening', 'Closing', 'Test', 'Net sales (L)', ''].map((h, i) => <th key={i} className={thCls}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {data.nozzles.map((n, i) => (
                      <tr key={n.id}>
                        <td className={tdCls + ' text-slate-500 text-xs'}>{i + 1}</td>
                        <td className={tdCls}>
                          <select className={inputCls} value={n.fuel} onChange={(e) => setNozzle(n.id, { fuel: e.target.value })}>{fuelOptions}</select>
                        </td>
                        <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={n.opening} onChange={(e) => setNozzle(n.id, { opening: e.target.value })} /></td>
                        <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={n.closing} onChange={(e) => setNozzle(n.id, { closing: e.target.value })} /></td>
                        <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={n.test} onChange={(e) => setNozzle(n.id, { test: e.target.value })} /></td>
                        <td className={tdCls + ' text-right tabular-nums'}>{fmtNum(num(n.closing) - num(n.opening) - num(n.test))}</td>
                        <td className={tdCls}>
                          <button onClick={() => setData((d) => ({ ...d, nozzles: d.nozzles.filter((x) => x.id !== n.id) }))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tank dips */}
            <div className={cardCls}>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Tank Stock</h2>
                  <p className="text-[11px] text-slate-500">Rename a tank (e.g. "Tank 1 MS") and pick its fuel.</p>
                </div>
                <button onClick={() => setData((d) => ({ ...d, tanks: [...d.tanks, { id: uid(), name: `Tank ${d.tanks.length + 1}`, fuel: d.fuels[0]?.id || 'ms', dip: '', ltr: '' }] }))}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"><Plus size={13} /> Add tank</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr>{['Tank', 'Fuel', 'Dip reading (ft)', 'Ltr stock', ''].map((h, i) => <th key={i} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {data.tanks.map((t) => (
                      <tr key={t.id}>
                        <td className={tdCls}><input className={inputCls} value={t.name} onChange={(e) => setTank(t.id, { name: e.target.value })} /></td>
                        <td className={tdCls}>
                          <select className={inputCls} value={t.fuel} onChange={(e) => setTank(t.id, { fuel: e.target.value })}>{fuelOptions}</select>
                        </td>
                        <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={t.dip} onChange={(e) => setTank(t.id, { dip: e.target.value })} /></td>
                        <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={t.ltr} onChange={(e) => setTank(t.id, { ltr: e.target.value })} /></td>
                        <td className={tdCls}>
                          <button onClick={() => setData((d) => ({ ...d, tanks: d.tanks.filter((x) => x.id !== t.id) }))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Sales */}
            <div className={cardCls + ' p-4 space-y-3'}>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sales Today</h2>
              {([
                ['cash', 'Cash sale'],
                ['card', 'Card / POS'],
                ['online', 'Online (PhonePe / Paytm)'],
                ['credit', 'Credit party sale'],
                ['other', 'Other inward'],
              ] as const).map(([key, label]) => (
                <div key={key} className="grid grid-cols-2 items-center gap-3">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
                  <input type="number" step="0.01" className={inputCls} value={data.sales[key]}
                    onChange={(e) => setData((d) => ({ ...d, sales: { ...d.sales, [key]: e.target.value } }))} />
                </div>
              ))}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Total received</span><span className="tabular-nums font-semibold">{fmtMoney(totals.inward)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Fuel sale amount (from stock table)</span><span className="tabular-nums">{fmtMoney(totals.fuelSaleAmount)}</span></div>
                <div className={'flex justify-between font-semibold ' + (Math.abs(totals.difference) < 0.5 ? 'text-emerald-600' : 'text-red-600')}>
                  <span>Difference</span><span className="tabular-nums">{fmtMoney(totals.difference)}</span>
                </div>
              </div>
            </div>

            {/* Cash & expenses */}
            <div className={cardCls}>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Cash in Hand &amp; Expenses</h2>
                <button onClick={() => setData((d) => ({ ...d, expenses: [...d.expenses, { id: uid(), particulars: '', amount: '', mode: 'cash' }] }))}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"><Plus size={13} /> Add expense</button>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 items-center gap-3">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Total cash in hand today</label>
                  <input type="number" step="0.01" className={inputCls} value={data.cashInHand}
                    onChange={(e) => setData((d) => ({ ...d, cashInHand: e.target.value }))} />
                </div>
                {data.expenses.length > 0 && (
                  <table className="w-full text-sm">
                    <thead><tr>{['Particulars', 'Amount', 'Mode', ''].map((h, i) => <th key={i} className={thCls}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {data.expenses.map((e) => (
                        <tr key={e.id}>
                          <td className={tdCls}><input className={inputCls} value={e.particulars} onChange={(ev) => setExpense(e.id, { particulars: ev.target.value })} /></td>
                          <td className={tdCls}><input type="number" step="0.01" className={inputCls} value={e.amount} onChange={(ev) => setExpense(e.id, { amount: ev.target.value })} /></td>
                          <td className={tdCls}>
                            <select className={inputCls} value={e.mode} onChange={(ev) => setExpense(e.id, { mode: ev.target.value as 'cash' | 'online' })}>
                              <option value="cash">Cash</option>
                              <option value="online">Online</option>
                            </select>
                          </td>
                          <td className={tdCls}>
                            <button onClick={() => setData((d) => ({ ...d, expenses: d.expenses.filter((x) => x.id !== e.id) }))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">Cash expenses</span><span className="tabular-nums">{fmtMoney(totals.cashExp)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Online expenses</span><span className="tabular-nums">{fmtMoney(totals.onlineExp)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total expenses (cash + online)</span><span className="tabular-nums">{fmtMoney(totals.totalExp)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Trend (chosen firm, or all firms together) */}
      <div className={cardCls + ' p-5'}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-indigo-500" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Trend{isAll ? ' · all firms' : ''}</h2>
              <p className="text-xs text-slate-500">Sales and expenses (bars), closing cash in hand (line)</p>
            </div>
          </div>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={'px-3 py-1.5 text-xs font-semibold ' + (period === p.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {historyLoading ? (
          <div className="flex justify-center h-64 items-center"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-sm font-medium text-slate-500">No saved reports in this range yet</p>
            <p className="text-xs text-slate-400 mt-1">Save a daily report to start the trend</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v}`} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name="Sales" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Line type="monotone" dataKey="cashInHand" name="Cash in hand" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Fuel and tank names can be changed at any time. Tanks and nozzles pick their fuel from the list above.
      </p>
    </div>
  );
}
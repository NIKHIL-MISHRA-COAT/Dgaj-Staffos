'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface FirmRow { id: string; name: string; code: string | null }
interface Person { id: string; full_name: string | null; job_title: string | null; department: string | null }
interface EditorRow { firm_id: string; user_id: string }
type ReportType = 'fuel' | 'hospital';

// Director Settings → Daily Report
// 1. Choose which firms appear in the daily report.
// 2. For each included firm, choose its report type (fuel station or hospital).
// 3. For each included firm, assign the employees who may edit its report.
export default function DailyReportAccessSettings() {
  const supabase = createClient();
  const [firms, setFirms] = useState<FirmRow[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Record<string, ReportType>>({});
  const [editors, setEditors] = useState<EditorRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, inc, ed, pp] = await Promise.all([
      supabase.from('firms').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('daily_report_firms').select('firm_id, report_type'),
      supabase.from('daily_report_editors').select('firm_id, user_id'),
      supabase.from('user_profiles').select('id, full_name, job_title, department').eq('is_active', true).order('full_name'),
    ]);
    if (f.error || inc.error || ed.error || pp.error) toast.error('Could not load daily report settings');
    setFirms((f.data as FirmRow[]) || []);
    const incRows = (inc.data || []) as { firm_id: string; report_type: string | null }[];
    setIncluded(new Set(incRows.map((r) => r.firm_id)));
    setTypes(Object.fromEntries(incRows.map((r) => [r.firm_id, r.report_type === 'hospital' ? 'hospital' : 'fuel'])));
    setEditors((ed.data as EditorRow[]) || []);
    setPeople((pp.data as Person[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const personName = (id: string) => people.find((p) => p.id === id)?.full_name || 'Unknown';

  const toggleFirm = async (firmId: string, on: boolean) => {
    setBusy(true);
    const { error } = on
      ? await supabase.from('daily_report_firms').insert({ firm_id: firmId })
      : await supabase.from('daily_report_firms').delete().eq('firm_id', firmId);
    setBusy(false);
    if (error) { toast.error(`Could not update: ${error.message}`); return; }
    toast.success(on ? 'Firm added to daily report' : 'Firm removed from daily report');
    load();
  };

  const setReportType = async (firmId: string, type: ReportType) => {
    setBusy(true);
    const { error } = await supabase.from('daily_report_firms').update({ report_type: type }).eq('firm_id', firmId);
    setBusy(false);
    if (error) { toast.error(`Could not update report type: ${error.message}`); return; }
    toast.success(type === 'hospital' ? 'Hospital report selected' : 'Fuel station report selected');
    load();
  };

  const addEditor = async (firmId: string, userId: string) => {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.from('daily_report_editors').insert({ firm_id: firmId, user_id: userId });
    setBusy(false);
    if (error) { toast.error(`Could not assign: ${error.message}`); return; }
    toast.success('Editor assigned');
    load();
  };

  const removeEditor = async (firmId: string, userId: string) => {
    setBusy(true);
    const { error } = await supabase.from('daily_report_editors').delete().eq('firm_id', firmId).eq('user_id', userId);
    setBusy(false);
    if (error) { toast.error(`Could not remove: ${error.message}`); return; }
    toast.success('Editor removed');
    load();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-violet-500" /></div>;
  }

  if (firms.length === 0) {
    return <p className="text-sm text-slate-500">No active firms yet. Add firms under Firm Configuration first.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Tick the firms that should appear in the Daily Report. For each ticked firm, assign the employees who can enter and edit its report.
        Employees see the Daily Report menu only when they are assigned to at least one firm. Directors see every firm.
      </p>

      {firms.map((firm) => {
        const isIncluded = included.has(firm.id);
        const assigned = editors.filter((e) => e.firm_id === firm.id);
        const available = people.filter((p) => !assigned.some((a) => a.user_id === p.id));

        return (
          <div key={firm.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isIncluded}
                disabled={busy}
                onChange={(e) => toggleFirm(firm.id, e.target.checked)}
                className="w-4 h-4 accent-violet-600"
              />
              <span className="text-sm font-semibold text-slate-800">{firm.name}</span>
              {firm.code && <span className="text-xs font-mono text-slate-500">{firm.code}</span>}
              {!isIncluded && <span className="text-xs text-slate-400 ml-auto">Not in daily report</span>}
            </label>

            {isIncluded && (
              <div className="pl-7 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-600">Report type</p>
                  <select
                    value={types[firm.id] || 'fuel'}
                    disabled={busy}
                    onChange={(e) => setReportType(firm.id, e.target.value as ReportType)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="fuel">Fuel station (litres, rates, tanks, cash)</option>
                    <option value="hospital">Hospital (cash sales, UPI sales, expenses, cash in hand)</option>
                  </select>
                </div>
                <p className="text-xs font-semibold text-slate-600">Editors for this firm</p>
                <div className="flex flex-wrap gap-2">
                  {assigned.length === 0 && <span className="text-xs text-slate-400 italic">No editor assigned yet</span>}
                  {assigned.map((a) => (
                    <span key={a.user_id} className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1 rounded-full">
                      {personName(a.user_id)}
                      <button onClick={() => removeEditor(firm.id, a.user_id)} disabled={busy} className="text-violet-400 hover:text-red-600">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Plus size={14} className="text-slate-400" />
                  <select
                    value=""
                    disabled={busy || available.length === 0}
                    onChange={(e) => addEditor(firm.id, e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]"
                  >
                    <option value="">{available.length === 0 ? 'No more employees to add' : 'Add an employee…'}</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || 'Unnamed'}{p.department ? ` · ${p.department}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
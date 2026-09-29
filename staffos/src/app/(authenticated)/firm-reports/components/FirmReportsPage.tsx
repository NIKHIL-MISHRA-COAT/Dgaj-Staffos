'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, TrendingUp, Users, CheckSquare, Calendar, Clock, Layers } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

type Period = 'daily' | 'weekly' | 'monthly';

interface Firm { id: string; name: string; code: string; }

interface FirmMetrics {
  firmId: string;
  firmName: string;
  activeEmployees: number;
  tasksTotal: number;
  tasksDone: number;
  attendancePresent: number;
  attendanceTotal: number;
  leaveRequests: number;
}

const emptyMetrics = (firmId: string, firmName: string): FirmMetrics => ({
  firmId, firmName, activeEmployees: 0, tasksTotal: 0, tasksDone: 0, attendancePresent: 0, attendanceTotal: 0, leaveRequests: 0,
});

function getRange(period: Period): { start: string; startDate: string } {
  const now = new Date();
  const start = new Date(now);
  if (period === 'daily') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), startDate: start.toISOString().split('T')[0] };
}

export default function FirmReportsPage() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();

  const [role, setRole] = useState('employee');
  const [period, setPeriod] = useState<Period>('daily');
  const [firms, setFirms] = useState<Firm[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState<'all' | string>('all');
  const [metricsByFirm, setMetricsByFirm] = useState<Record<string, FirmMetrics>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('user_profiles').select('role').eq('id', effectiveUserId).single().then(({ data }) => {
      if (data?.role) setRole(data.role);
    });
  }, [effectiveUserId]);

  const isDirector = role === 'director';

  const loadReport = useCallback(async () => {
    setLoading(true);
    const { start, startDate } = getRange(period);

    const [firmsRes, tasksRes, attendanceRes, leaveRes, employeesRes] = await Promise.all([
      supabase.from('firms').select('id, name, code').order('name'),
      supabase.from('tasks').select('id, firm_id, status').gte('created_at', start),
      supabase.from('attendance_records').select('id, firm_id, status').gte('work_date', startDate),
      supabase.from('leave_requests').select('id, firm_id').gte('created_at', start),
      supabase.from('user_profiles').select('id, firm_id').eq('is_active', true),
    ]);

    const firmList = (firmsRes.data as Firm[]) || [];
    setFirms(firmList);

    const map: Record<string, FirmMetrics> = {};
    firmList.forEach((f) => { map[f.id] = emptyMetrics(f.id, f.name); });
    // Bucket for rows with no firm_id (pre-multi-firm data) so nothing silently vanishes from the totals.
    map['__unassigned'] = emptyMetrics('__unassigned', 'Unassigned');

    const bucket = (firmId: string | null) => map[firmId || '__unassigned'] || map['__unassigned'];

    (employeesRes.data || []).forEach((row: any) => { bucket(row.firm_id).activeEmployees += 1; });
    (tasksRes.data || []).forEach((row: any) => {
      const m = bucket(row.firm_id);
      m.tasksTotal += 1;
      if (row.status === 'done') m.tasksDone += 1;
    });
    (attendanceRes.data || []).forEach((row: any) => {
      const m = bucket(row.firm_id);
      m.attendanceTotal += 1;
      if (row.status === 'present' || row.status === 'half_day' || row.status === 'work_from_home') m.attendancePresent += 1;
    });
    (leaveRes.data || []).forEach((row: any) => { bucket(row.firm_id).leaveRequests += 1; });

    setMetricsByFirm(map);
    setLoading(false);
  }, [period]);

  useEffect(() => { if (isDirector) loadReport(); }, [isDirector, loadReport]);

  const combined = useMemo(() => {
    const rows = Object.values(metricsByFirm);
    return rows.reduce((acc, m) => ({
      firmId: 'all', firmName: 'All Firms (Combined)',
      activeEmployees: acc.activeEmployees + m.activeEmployees,
      tasksTotal: acc.tasksTotal + m.tasksTotal,
      tasksDone: acc.tasksDone + m.tasksDone,
      attendancePresent: acc.attendancePresent + m.attendancePresent,
      attendanceTotal: acc.attendanceTotal + m.attendanceTotal,
      leaveRequests: acc.leaveRequests + m.leaveRequests,
    }), emptyMetrics('all', 'All Firms (Combined)'));
  }, [metricsByFirm]);

  const displayedFirms = firms.filter((f) => (metricsByFirm[f.id]?.activeEmployees ?? 0) > 0 || (metricsByFirm[f.id]?.tasksTotal ?? 0) > 0 || true);
  const current = selectedFirmId === 'all' ? combined : metricsByFirm[selectedFirmId] || emptyMetrics(selectedFirmId, '—');

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  if (!isDirector) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400 text-sm">
        This report is only available to directors.
      </div>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-700 text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp size={22} className="text-blue-600" /> Firm Reports
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mt-1">
            Activity across every firm — view each one separately or combined.
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden text-xs font-600">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3.5 py-2 capitalize ${period === p ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Firm tabs */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedFirmId('all')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-600 whitespace-nowrap border ${selectedFirmId === 'all' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
        >
          <Layers size={13} /> All Firms (Combined)
        </button>
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => setSelectedFirmId(f.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-600 whitespace-nowrap border ${selectedFirmId === f.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
          >
            <Building2 size={13} /> {f.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
      ) : (
        <>
          {/* KPI cards for current selection */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-600 mb-1"><Users size={13} /> Active Employees</div>
              <div className="text-2xl font-700 text-slate-900 dark:text-slate-100">{current.activeEmployees}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-600 mb-1"><CheckSquare size={13} /> Tasks Completed</div>
              <div className="text-2xl font-700 text-slate-900 dark:text-slate-100">{current.tasksDone}<span className="text-sm text-slate-400 font-500">/{current.tasksTotal}</span></div>
              <div className="text-[11px] text-slate-400 mt-0.5">{pct(current.tasksDone, current.tasksTotal)}% completion</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-600 mb-1"><Clock size={13} /> Attendance</div>
              <div className="text-2xl font-700 text-slate-900 dark:text-slate-100">{pct(current.attendancePresent, current.attendanceTotal)}%</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{current.attendancePresent}/{current.attendanceTotal} present</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-600 mb-1"><Calendar size={13} /> Leave Requests</div>
              <div className="text-2xl font-700 text-slate-900 dark:text-slate-100">{current.leaveRequests}</div>
            </div>
          </div>

          {/* Side-by-side comparison table — always visible so "combined" view still shows the per-firm breakdown */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 text-xs font-700 text-slate-600 dark:text-slate-300">
              Per-firm breakdown ({period})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400 font-600 border-b border-slate-100 dark:border-slate-700">
                    <th className="px-4 py-2">Firm</th>
                    <th className="px-4 py-2">Employees</th>
                    <th className="px-4 py-2">Tasks</th>
                    <th className="px-4 py-2">Attendance</th>
                    <th className="px-4 py-2">Leave</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedFirms.map((f) => {
                    const m = metricsByFirm[f.id] || emptyMetrics(f.id, f.name);
                    return (
                      <tr key={f.id} className="border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                        <td className="px-4 py-2.5 font-600 text-slate-700 dark:text-slate-200">{f.name} <span className="text-slate-400 font-400">({f.code})</span></td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{m.activeEmployees}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{m.tasksDone}/{m.tasksTotal} <span className="text-slate-400">({pct(m.tasksDone, m.tasksTotal)}%)</span></td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{pct(m.attendancePresent, m.attendanceTotal)}%</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{m.leaveRequests}</td>
                      </tr>
                    );
                  })}
                  {metricsByFirm['__unassigned']?.tasksTotal + metricsByFirm['__unassigned']?.activeEmployees + metricsByFirm['__unassigned']?.attendanceTotal + metricsByFirm['__unassigned']?.leaveRequests > 0 && (
                    <tr className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
                      <td className="px-4 py-2.5 font-600 text-slate-500 italic">Unassigned (no firm set)</td>
                      <td className="px-4 py-2.5 text-slate-500">{metricsByFirm['__unassigned'].activeEmployees}</td>
                      <td className="px-4 py-2.5 text-slate-500">{metricsByFirm['__unassigned'].tasksDone}/{metricsByFirm['__unassigned'].tasksTotal}</td>
                      <td className="px-4 py-2.5 text-slate-500">{pct(metricsByFirm['__unassigned'].attendancePresent, metricsByFirm['__unassigned'].attendanceTotal)}%</td>
                      <td className="px-4 py-2.5 text-slate-500">{metricsByFirm['__unassigned'].leaveRequests}</td>
                    </tr>
                  )}
                  <tr className="bg-violet-50 dark:bg-violet-900/20 font-700">
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">All Firms (Combined)</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{combined.activeEmployees}</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{combined.tasksDone}/{combined.tasksTotal} ({pct(combined.tasksDone, combined.tasksTotal)}%)</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{pct(combined.attendancePresent, combined.attendanceTotal)}%</td>
                    <td className="px-4 py-2.5 text-violet-700 dark:text-violet-300">{combined.leaveRequests}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

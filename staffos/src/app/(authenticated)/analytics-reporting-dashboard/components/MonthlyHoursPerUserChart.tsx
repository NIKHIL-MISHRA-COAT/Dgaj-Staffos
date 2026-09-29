'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BarChart2, Download, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';

interface UserMonthlyHoursRow {
  user_id: string;
  full_name: string;
  department: string;
  total_hours: number;
  overtime_hours: number;
  present_days: number;
  absent_days: number;
  late_days: number;
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MonthlyHoursPerUserChart() {
  const supabase = createClient();
  const [data, setData] = useState<UserMonthlyHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [year, month] = monthFilter.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

      const [attRes, profilesRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('user_id, total_hours, overtime_hours, status')
          .gte('work_date', startDate)
          .lte('work_date', endDate),
        supabase
          .from('user_profiles')
          .select('id, full_name, department')
          .eq('is_active', true),
      ]);

      const profiles = profilesRes.data || [];
      const empMap = new Map(profiles.map((p: any) => [p.id, p]));

      const userMap: Record<string, UserMonthlyHoursRow> = {};
      (attRes.data || []).forEach((r: any) => {
        const emp = empMap.get(r.user_id) as any;
        if (!userMap[r.user_id]) {
          userMap[r.user_id] = {
            user_id: r.user_id,
            full_name: emp?.full_name || 'Unknown',
            department: emp?.department || '—',
            total_hours: 0,
            overtime_hours: 0,
            present_days: 0,
            absent_days: 0,
            late_days: 0,
          };
        }
        userMap[r.user_id].total_hours += Number(r.total_hours) || 0;
        userMap[r.user_id].overtime_hours += Number(r.overtime_hours) || 0;
        if (['present', 'work_from_home', 'half_day'].includes(r.status)) userMap[r.user_id].present_days++;
        if (r.status === 'absent') userMap[r.user_id].absent_days++;
        if (r.status === 'late') userMap[r.user_id].late_days++;
      });

      setData(Object.values(userMap).sort((a, b) => b.total_hours - a.total_hours));
    } catch (err) {
      console.error('Monthly hours fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [monthFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportCSV = () => {
    if (!data.length) { toast.error('No data to export'); return; }
    const headers = ['Employee', 'Department', 'Total Hours', 'Overtime Hours', 'Present Days', 'Absent Days', 'Late Days'];
    const rows = data.map((u) => [
      u.full_name,
      u.department,
      u.total_hours.toFixed(2),
      u.overtime_hours.toFixed(2),
      String(u.present_days),
      String(u.absent_days),
      String(u.late_days),
    ]);
    downloadCSV(`monthly_hours_${monthFilter}.csv`, headers, rows);
    toast.success('Monthly hours exported');
  };

  const maxHours = data.length > 0 ? Math.max(...data.map((u) => u.total_hours)) : 1;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-indigo-500" />
          <div>
            <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Monthly Attendance Hours</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Hours worked per employee this month</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
          />
          <button onClick={fetchData} disabled={loading} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={exportCSV}
            disabled={!data.length}
            className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 hover:text-indigo-600 border border-slate-200 dark:border-slate-600 hover:border-indigo-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Users size={28} className="text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No attendance data for this month</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {data.map((u) => (
            <div key={u.user_id} className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-700 text-indigo-700 dark:text-indigo-300">{u.full_name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs font-600 text-slate-800 dark:text-slate-200 truncate">{u.full_name}</p>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <span className="text-xs font-700 text-indigo-700 dark:text-indigo-300 tabular-nums">{u.total_hours.toFixed(1)}h</span>
                    {u.overtime_hours > 0 && (
                      <span className="text-[10px] font-600 text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-full">+{u.overtime_hours.toFixed(1)}h OT</span>
                    )}
                  </div>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${maxHours > 0 ? (u.total_hours / maxHours) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{u.department} · {u.present_days}P {u.absent_days > 0 ? `${u.absent_days}A` : ''} {u.late_days > 0 ? `${u.late_days}L` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{data.length} employees</span>
          <span className="font-600 text-indigo-700 dark:text-indigo-300">
            Total: {data.reduce((s, u) => s + u.total_hours, 0).toFixed(1)}h
          </span>
        </div>
      )}
    </div>
  );
}

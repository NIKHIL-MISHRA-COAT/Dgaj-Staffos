'use client';

import React, { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, ArrowUpDown, TrendingUp, TrendingDown, BarChart2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) { toast.error('No data to export'); return; }
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map((row) => headers.map((h) => {
      const val = row[h] ?? '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    }).join(',')),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${data.length} rows to ${filename}`);
}

interface DeptRow {
  id: string;
  department: string;
  headcount: number;
  presentToday: number;
  attendanceRate: number;
  taskCompletion: number;
  productivityScore: number;
  openTickets: number;
  pendingLeaves: number;
  overtimeHrs: number;
  trend: 'up' | 'down' | 'neutral';
}

type SortKey = keyof DeptRow;

export default function DepartmentBreakdownTable() {
  const supabase = createClient();
  const [deptData, setDeptData] = useState<DeptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('department');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const [profilesRes, attendanceTodayRes, attendanceMonthRes, ticketsRes, leavesRes, tasksRes] = await Promise.all([
        supabase.from('user_profiles').select('id, department').eq('is_active', true),
        supabase.from('attendance_records').select('user_id, status').eq('work_date', today),
        supabase.from('attendance_records').select('user_id, status, overtime_hours').gte('work_date', monthStart).lte('work_date', monthEnd),
        supabase.from('support_tickets').select('user_id').in('status', ['open', 'in_progress']),
        supabase.from('leave_requests').select('user_id').eq('status', 'pending'),
        supabase.from('tasks').select('assigned_to, status'),
      ]);

      const profiles = profilesRes.data || [];
      const todayAtt = attendanceTodayRes.data || [];
      const monthAtt = attendanceMonthRes.data || [];
      const tickets = ticketsRes.data || [];
      const leaves = leavesRes.data || [];
      const tasks = tasksRes.data || [];

      // Build user → dept map
      const userDeptMap: Record<string, string> = {};
      profiles.forEach((p) => { if (p.department) userDeptMap[p.id] = p.department; });

      // Group by department
      const depts = [...new Set(profiles.map((p) => p.department).filter(Boolean))] as string[];

      const rows: DeptRow[] = depts.map((dept) => {
        const deptUsers = profiles.filter((p) => p.department === dept).map((p) => p.id);
        const headcount = deptUsers.length;

        // Present today
        const todayDeptAtt = todayAtt.filter((a) => deptUsers.includes(a.user_id));
        const presentToday = todayDeptAtt.filter((a) => ['present', 'late', 'half_day', 'work_from_home'].includes(a.status)).length;

        // Monthly attendance rate
        const monthDeptAtt = monthAtt.filter((a) => deptUsers.includes(a.user_id) && !['weekend', 'holiday'].includes(a.status));
        const monthPresent = monthDeptAtt.filter((a) => ['present', 'late', 'half_day', 'work_from_home'].includes(a.status)).length;
        const attendanceRate = monthDeptAtt.length > 0 ? Math.round((monthPresent / monthDeptAtt.length) * 100 * 10) / 10 : 0;

        // Overtime
        const overtimeHrs = Math.round(monthAtt.filter((a) => deptUsers.includes(a.user_id)).reduce((sum, a) => sum + (Number(a.overtime_hours) || 0), 0) * 10) / 10;

        // Productivity
        const productivityScore = Math.round(attendanceRate * 0.85);

        // Task completion
        const deptTasks = tasks.filter((t) => t.assigned_to && deptUsers.includes(t.assigned_to));
        const doneTasks = deptTasks.filter((t) => t.status === 'done').length;
        const taskCompletion = deptTasks.length > 0 ? Math.round((doneTasks / deptTasks.length) * 100 * 10) / 10 : 0;

        // Open tickets
        const openTickets = tickets.filter((t) => deptUsers.includes(t.user_id)).length;

        // Pending leaves
        const pendingLeaves = leaves.filter((l) => deptUsers.includes(l.user_id)).length;

        // Trend
        const trend: 'up' | 'down' | 'neutral' = attendanceRate >= 90 ? 'up' : attendanceRate < 75 ? 'down' : 'neutral';

        return {
          id: dept,
          department: dept,
          headcount,
          presentToday,
          attendanceRate,
          taskCompletion,
          productivityScore,
          openTickets,
          pendingLeaves,
          overtimeHrs,
          trend,
        };
      }).filter((r) => r.headcount > 0);

      setDeptData(rows);
    } catch (err) {
      console.error('Dept breakdown fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...deptData].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-slate-300" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />;
  };

  const getScoreColor = (score: number) => score >= 85 ? 'text-emerald-500' : score >= 75 ? 'text-blue-600' : score >= 65 ? 'text-amber-600' : 'text-red-500';
  const getAttendanceColor = (rate: number) => rate >= 93 ? 'text-emerald-600' : rate >= 87 ? 'text-blue-600' : rate >= 80 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
        <div>
          <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Department Breakdown</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Click column headers to sort</p>
        </div>
        <button onClick={() => downloadCSV(sorted, `department-breakdown-${new Date().toISOString().split('T')[0]}.csv`)} className="btn-ghost text-xs border border-slate-200 dark:border-slate-700">Export CSV</button>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-16 text-center px-5">
          <BarChart2 size={32} className="text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No department data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Data will appear once employees are added and activity is recorded</p>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                {[
                  { key: 'department' as SortKey, label: 'Department' },
                  { key: 'headcount' as SortKey, label: 'Headcount' },
                  { key: 'presentToday' as SortKey, label: 'Present Today' },
                  { key: 'attendanceRate' as SortKey, label: 'Attendance %' },
                  { key: 'taskCompletion' as SortKey, label: 'Task Done %' },
                  { key: 'productivityScore' as SortKey, label: 'Productivity' },
                  { key: 'openTickets' as SortKey, label: 'Open Tickets' },
                  { key: 'pendingLeaves' as SortKey, label: 'Pending Leaves' },
                  { key: 'overtimeHrs' as SortKey, label: 'OT Hours' },
                  { key: 'trend' as SortKey, label: 'Trend' },
                ].map((col) => (
                  <th key={`th-${col.key}`} onClick={() => handleSort(col.key)}
                    className="px-4 py-3 text-left text-[11px] font-600 uppercase tracking-wider text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 whitespace-nowrap select-none">
                    <div className="flex items-center gap-1.5">{col.label}<SortIcon col={col.key} /></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
              {sorted.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-3 font-600 text-slate-900 dark:text-slate-100 whitespace-nowrap">{row.department}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300 tabular-nums">{row.headcount}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className="text-slate-700 dark:text-slate-300">{row.presentToday}</span>
                    <span className="text-slate-400 dark:text-slate-500 text-xs ml-1">/ {row.headcount}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className={`font-600 ${getAttendanceColor(row.attendanceRate)}`}>{row.attendanceRate.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden min-w-[48px]">
                        <div className={`h-full rounded-full ${row.taskCompletion >= 80 ? 'bg-emerald-500' : row.taskCompletion >= 65 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${row.taskCompletion}%` }} />
                      </div>
                      <span className={`text-xs font-600 tabular-nums ${row.taskCompletion >= 80 ? 'text-emerald-600' : row.taskCompletion >= 65 ? 'text-amber-600' : 'text-red-500'}`}>{row.taskCompletion.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-700 tabular-nums ${getScoreColor(row.productivityScore)}`}>{row.productivityScore}</span>
                    <span className="text-slate-400 dark:text-slate-500 text-xs">/100</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.openTickets > 0 ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-600 ${row.openTickets >= 5 ? 'bg-red-50 dark:bg-red-900/30 text-red-600' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600'}`}>{row.openTickets}</span>
                    ) : <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.pendingLeaves > 0 ? <span className="text-slate-700 dark:text-slate-300">{row.pendingLeaves}</span> : <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">{row.overtimeHrs}h</td>
                  <td className="px-4 py-3">
                    {row.trend === 'up' && <TrendingUp size={15} className="text-emerald-500" />}
                    {row.trend === 'down' && <TrendingDown size={15} className="text-red-400" />}
                    {row.trend === 'neutral' && <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/50 dark:bg-slate-700/30">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {sorted.length > 0 ? (
            <>Total: <span className="font-600 text-slate-700 dark:text-slate-300">{sorted.reduce((s, r) => s + r.headcount, 0)} employees</span> across {sorted.length} departments</>
          ) : 'No department data available'}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Live data</p>
      </div>
    </div>
  );
}
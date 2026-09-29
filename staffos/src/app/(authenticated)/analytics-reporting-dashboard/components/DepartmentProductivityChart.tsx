'use client';

import React, { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { createClient } from '@/lib/supabase/client';

interface DeptData {
  department: string;
  score: number;
  color: string;
}

function getBarColor(score: number): string {
  if (score >= 85) return '#10b981';
  if (score >= 75) return '#3b82f6';
  if (score >= 65) return '#f59e0b';
  return '#ef4444';
}

export default function DepartmentProductivityChart() {
  const supabase = createClient();
  const [chartData, setChartData] = useState<DeptData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, department')
        .eq('is_active', true);

      const { data: attendance } = await supabase
        .from('attendance_records')
        .select('user_id, status')
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd);

      if (!profiles || !attendance) return;

      // Map user → department
      const userDeptMap: Record<string, string> = {};
      profiles.forEach((p) => { if (p.department) userDeptMap[p.id] = p.department; });

      // Group attendance by department
      const deptStats: Record<string, { total: number; present: number }> = {};
      attendance.forEach((r) => {
        const dept = userDeptMap[r.user_id];
        if (!dept || ['weekend', 'holiday'].includes(r.status)) return;
        if (!deptStats[dept]) deptStats[dept] = { total: 0, present: 0 };
        deptStats[dept].total++;
        if (['present', 'late', 'half_day', 'work_from_home'].includes(r.status)) {
          deptStats[dept].present++;
        }
      });

      const result = Object.entries(deptStats)
        .filter(([, s]) => s.total >= 3)
        .map(([dept, s]) => {
          const score = Math.round((s.present / s.total) * 85);
          return { department: dept.length > 12 ? dept.slice(0, 12) + '…' : dept, score, color: getBarColor(score) };
        })
        .sort((a, b) => b.score - a.score);

      setChartData(result);
    } catch (err) {
      console.error('Dept productivity fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasData = chartData.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Department Productivity</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Avg score per department · Current month</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] flex-wrap text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />≥85</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />75–84</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />65–74</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400" />&lt;65</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[220px]">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-[220px] text-center">
          <BarChart2 size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No productivity data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Department scores will appear once employees are active</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip
              formatter={(value: number) => [`${value}%`, 'Productivity']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
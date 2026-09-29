'use client';

import React, { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { createClient } from '@/lib/supabase/client';

interface LeaveData {
  type: string;
  count: number;
  color: string;
}

const leaveColors: Record<string, string> = {
  casual: '#3b82f6',
  sick: '#ef4444',
  paid: '#10b981',
  comp_off: '#8b5cf6',
  work_from_home: '#f59e0b',
  maternity: '#ec4899',
  paternity: '#06b6d4',
  unpaid: '#94a3b8',
};

export default function LeavePatternChart() {
  const supabase = createClient();
  const [chartData, setChartData] = useState<LeaveData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const currentYear = new Date().getFullYear();
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;

      const { data, error } = await supabase
        .from('leave_requests')
        .select('leave_type, total_days')
        .eq('status', 'approved')
        .gte('start_date', yearStart)
        .lte('end_date', yearEnd);

      if (error) throw error;

      const typeMap: Record<string, number> = {};
      (data || []).forEach((r) => {
        typeMap[r.leave_type] = (typeMap[r.leave_type] || 0) + (r.total_days || 1);
      });

      const result = Object.entries(typeMap).map(([type, count]) => ({
        type: type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        count,
        color: leaveColors[type] || '#94a3b8',
      })).sort((a, b) => b.count - a.count);

      setChartData(result);
    } catch (err) {
      console.error('Leave pattern fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasData = chartData.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Leave Patterns</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Leave days taken by type · {new Date().getFullYear()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[220px]">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-[220px] text-center">
          <CalendarDays size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No leave data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Leave patterns will appear once employees submit leave requests</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="type" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
            <Tooltip
              formatter={(value: number) => [`${value} days`, 'Days taken']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
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
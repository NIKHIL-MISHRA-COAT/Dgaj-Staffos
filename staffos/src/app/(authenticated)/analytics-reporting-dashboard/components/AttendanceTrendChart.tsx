'use client';

import React, { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { createClient } from '@/lib/supabase/client';

interface DayData {
  date: string;
  present: number;
  late: number;
  absent: number;
}

export default function AttendanceTrendChart() {
  const supabase = createClient();
  const [chartData, setChartData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDate = thirtyDaysAgo.toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('attendance_records')
        .select('work_date, status')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date', { ascending: true });

      if (error) throw error;

      // Group by date
      const dateMap: Record<string, { present: number; late: number; absent: number }> = {};
      (data || []).forEach((r) => {
        if (!dateMap[r.work_date]) dateMap[r.work_date] = { present: 0, late: 0, absent: 0 };
        if (['present', 'work_from_home', 'half_day'].includes(r.status)) dateMap[r.work_date].present++;
        else if (r.status === 'late') dateMap[r.work_date].late++;
        else if (r.status === 'absent') dateMap[r.work_date].absent++;
      });

      // Build last 14 days with data
      const result: DayData[] = Object.entries(dateMap)
        .map(([date, counts]) => ({
          date: new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          ...counts,
        }))
        .slice(-14);

      setChartData(result);
    } catch (err) {
      console.error('Attendance trend fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasData = chartData.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5 h-full">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Attendance Trend</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Last 30 days · All employees</p>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="w-3 h-2 bg-emerald-500 rounded-sm" />Present</span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="w-3 h-2 bg-amber-400 rounded-sm" />Late</span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="w-3 h-2 bg-red-400 rounded-sm" />Absent</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[240px]">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-[240px] text-center">
          <BarChart2 size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No attendance data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Trend will appear once employees start clocking in</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Bar dataKey="present" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} maxBarSize={32} />
            <Bar dataKey="late" stackId="a" fill="#f59e0b" maxBarSize={32} />
            <Bar dataKey="absent" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
'use client';

import React, { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

interface DayData {
  day: string;
  hours: number;
  status: string;
}

export default function WeeklyAttendanceChart() {
  const { t } = useLanguage();
  const { user, pinSession } = useAuth();
  const supabase = createClient();
  const [chartData, setChartData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalHours, setTotalHours] = useState(0);

  const getEffectiveUserId = (): string | null => {
    if (user?.id) return user.id;
    if (pinSession?.userId) return pinSession.userId;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.userId || null;
      }
    } catch {}
    return null;
  };

  useEffect(() => {
    const uid = getEffectiveUserId();
    if (!uid) {
      setLoading(false);
      return;
    }
    fetchWeeklyData(uid);
  }, [user?.id, pinSession?.userId]);

  const fetchWeeklyData = async (uid: string) => {
    setLoading(true);
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const weekStart = monday.toISOString().split('T')[0];
      const weekEnd = today.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('attendance_records')
        .select('work_date, total_hours, status')
        .eq('user_id', uid)
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd)
        .order('work_date', { ascending: true });

      if (error) throw error;

      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const recordMap: Record<string, { hours: number; status: string }> = {};
      (data || []).forEach((r) => {
        recordMap[r.work_date] = { hours: Number(r.total_hours) || 0, status: r.status };
      });

      const result: DayData[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const rec = recordMap[dateStr];
        result.push({
          day: dayNames[i],
          hours: rec ? Math.round(rec.hours * 10) / 10 : 0,
          status: rec?.status || (d > today ? 'future' : 'absent'),
        });
      }

      setChartData(result);
      setTotalHours(result.reduce((sum, d) => sum + d.hours, 0));
    } catch (err) {
      console.error('Weekly attendance fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getBarColor = (status: string) => {
    if (status === 'present' || status === 'work_from_home') return '#10b981';
    if (status === 'late' || status === 'half_day') return '#f59e0b';
    if (status === 'absent') return '#f87171';
    return '#e2e8f0';
  };

  const hasData = chartData.some((d) => d.hours > 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4 sm:p-5">
      <div className="flex items-start justify-between mb-4 gap-2">
        <div>
          <h3 className="text-sm sm:text-base font-600 text-slate-900 dark:text-slate-100">Weekly Hours Worked</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {loading ? 'Loading…' : hasData ? `${Math.round(totalHours * 10) / 10}h this week` : 'No attendance data yet'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap justify-end flex-shrink-0">
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2 bg-emerald-500 rounded-sm" /><span className="hidden sm:inline">Present</span></span>
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2 bg-amber-400 rounded-sm" /><span className="hidden sm:inline">Late</span></span>
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2 bg-red-400 rounded-sm" /><span className="hidden sm:inline">Absent</span></span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[160px] sm:h-[200px]">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center h-[160px] sm:h-[200px] text-center">
          <BarChart2 size={28} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No attendance data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Clock in to start tracking your hours</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160} className="sm:!h-[200px]">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="h" />
            <Tooltip
              formatter={(value: number) => [`${value}h`, 'Hours']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.status)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
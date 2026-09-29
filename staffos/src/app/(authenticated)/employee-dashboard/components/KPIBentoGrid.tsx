'use client';

import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  CalendarDays,
  Zap,
  Clock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

interface KPIData {
  tasksCompleted: number | null;
  productivityScore: number | null;
  leaveRemaining: number | null;
  overtimeHours: number | null;
  openTickets: number | null;
  attendanceRate: number | null;
}

export default function KPIBentoGrid() {
  const { t } = useLanguage();
  const { user, pinSession } = useAuth();
  const supabase = createClient();
  const [kpi, setKpi] = useState<KPIData>({
    tasksCompleted: null,
    productivityScore: null,
    leaveRemaining: null,
    overtimeHours: null,
    openTickets: null,
    attendanceRate: null,
  });
  const [loading, setLoading] = useState(true);

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
    if (!uid) return;
    fetchKPIData(uid);
  }, [user?.id, pinSession?.userId]);

  const fetchKPIData = async (uid: string) => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      const currentFY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

      const [tasksRes, leaveBalRes, attendanceRes, ticketsRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, status, due_date, is_overdue')
          .or(`assigned_to.eq.${uid},assigned_user_ids.cs.{${uid}},assigned_to_user_id.eq.${uid}`),
        supabase
          .from('leave_balances')
          .select('leave_type, total_days, used_days')
          .eq('user_id', uid)
          .eq('fiscal_year', currentFY),
        supabase
          .from('attendance_records')
          .select('status, total_hours, overtime_hours')
          .eq('user_id', uid)
          .gte('work_date', monthStart)
          .lte('work_date', monthEnd),
        supabase
          .from('support_tickets')
          .select('id')
          .eq('user_id', uid)
          .in('status', ['open', 'in_progress']),
      ]);

      // All tasks assigned to this user
      const allTasks = tasksRes.data || [];
      const tasksCompleted = allTasks.filter((t) => t.status === 'done').length;
      const tasksPending = allTasks.filter((t) => ['todo', 'in-progress', 'review'].includes(t.status)).length;
      const tasksOverdue = allTasks.filter((t) =>
        t.is_overdue || (t.due_date && t.due_date < today && t.status !== 'done')
      ).length;

      // Leave remaining — try paid first, then substitute, then any
      const leaveData = leaveBalRes.data || [];
      const paidBalance = leaveData.find((b) => b.leave_type === 'paid');
      const substituteBalance = leaveData.find((b) => b.leave_type === 'substitute');
      const anyBalance = paidBalance || substituteBalance || leaveData[0];
      const leaveRemaining = anyBalance
        ? Math.max(0, anyBalance.total_days - anyBalance.used_days)
        : null;

      // Attendance rate & overtime this month
      const records = attendanceRes.data || [];
      const workingDays = records.filter((r) => !['weekend', 'holiday'].includes(r.status));
      const presentDays = workingDays.filter((r) => ['present', 'late', 'half_day', 'work_from_home'].includes(r.status));
      const attendanceRate = workingDays.length > 0
        ? Math.round((presentDays.length / workingDays.length) * 100)
        : 0;
      const overtimeHours = records.reduce((sum, r) => sum + (Number(r.overtime_hours) || 0), 0);

      // Productivity score: based on attendance rate + task completion rate
      const taskTotal = allTasks.length;
      const taskRate = taskTotal > 0 ? (tasksCompleted / taskTotal) * 100 : 0;
      const attRate = attendanceRate ?? 0;
      const productivityScore = taskTotal > 0 || records.length > 0
        ? Math.round((attRate * 0.6 + taskRate * 0.4))
        : 0;

      // Open tickets
      const openTickets = (ticketsRes.data || []).length;

      setKpi({
        tasksCompleted,
        productivityScore,
        leaveRemaining,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        openTickets,
        attendanceRate,
      });
    } catch (err) {
      console.error('KPI fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    {
      id: 'kpi-task-completion',
      label: 'Tasks Completed',
      value: kpi.tasksCompleted !== null ? String(kpi.tasksCompleted) : '0',
      sub: 'This week',
      icon: CheckSquare,
      colorClass: 'text-emerald-700 dark:text-emerald-400',
      bgClass: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      trend: (kpi.tasksCompleted ?? 0) > 0 ? 'up' : 'neutral',
    },
    {
      id: 'kpi-productivity',
      label: 'Productivity',
      value: kpi.productivityScore !== null ? `${kpi.productivityScore}%` : '0%',
      sub: 'Score',
      icon: Zap,
      colorClass: 'text-blue-700 dark:text-blue-400',
      bgClass: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800',
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      trend: (kpi.productivityScore ?? 0) >= 70 ? 'up' : 'down',
    },
    {
      id: 'kpi-leave',
      label: 'Leave Balance',
      value: kpi.leaveRemaining !== null ? `${kpi.leaveRemaining}d` : '—',
      sub: 'Days remaining',
      icon: CalendarDays,
      colorClass: 'text-purple-700 dark:text-purple-400',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-purple-100 dark:bg-purple-900/40',
      trend: 'neutral' as const,
    },
    {
      id: 'kpi-overtime',
      label: 'Overtime Hours',
      value: kpi.overtimeHours !== null ? `${kpi.overtimeHours}h` : '0h',
      sub: 'This month',
      icon: Clock,
      colorClass: 'text-amber-700 dark:text-amber-400',
      bgClass: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800',
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      trend: 'neutral' as const,
    },
    {
      id: 'kpi-open-tickets',
      label: 'Open Tickets',
      value: kpi.openTickets !== null ? String(kpi.openTickets) : '0',
      sub: kpi.openTickets === 0 ? 'All clear' : 'Pending',
      icon: AlertCircle,
      colorClass: 'text-slate-600 dark:text-slate-400',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
      trend: (kpi.openTickets ?? 0) > 0 ? 'down' : 'up',
    },
    {
      id: 'kpi-attendance-rate',
      label: 'Attendance Rate',
      value: kpi.attendanceRate !== null ? `${kpi.attendanceRate}%` : '0%',
      sub: 'Current month',
      icon: TrendingUp,
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
      trend: (kpi.attendanceRate ?? 0) >= 90 ? 'up' : 'down',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
      {cards.map((card) => {
        const CardIcon = card.icon;
        const TrendIcon = card.trend === 'up' ? TrendingUp : card.trend === 'down' ? TrendingDown : Minus;
        const trendColor = card.trend === 'up' ? 'text-emerald-600' : card.trend === 'down' ? 'text-red-500' : 'text-slate-400 dark:text-slate-500';

        return (
          <div
            key={card.id}
            className={`rounded-xl border ${card.bgClass} p-3 sm:p-4 shadow-sm relative overflow-hidden hover:shadow-card-hover transition-shadow duration-200`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                <CardIcon size={14} className={card.colorClass} />
              </div>
            </div>
            <p className={`text-xl sm:text-2xl font-700 tabular-nums ${card.colorClass} leading-none mb-1`}>
              {loading ? '…' : card.value}
            </p>
            <p className="text-[11px] sm:text-xs font-600 text-slate-700 dark:text-slate-300 leading-tight">{card.label}</p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 hidden sm:block">{card.sub}</p>
            <div className={`flex items-center gap-1 mt-1.5 ${trendColor}`}>
              <TrendIcon size={10} />
              <span className="text-[10px] font-500">
                {loading ? '…' : card.trend === 'up' ? '↑' : card.trend === 'down' ? '↓' : '—'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
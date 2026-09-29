'use client';

import React, { useEffect, useState } from 'react';
import {
  Users, Clock, Zap, AlertCircle, CheckSquare, Wallet,
  TrendingUp, TrendingDown, Minus, UserX, ClipboardList,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { createClient } from '@/lib/supabase/client';

interface KPIValues {
  headcount: number | null;
  avgAttendanceRate: number | null;
  avgProductivityScore: number | null;
  openTickets: number | null;
  pendingApprovals: number | null;
  overtimeCost: number | null;
  taskCompletionRate: number | null;
  turnoverRisk: number | null;
}

export default function AnalyticsKPIGrid() {
  const { t } = useLanguage();
  const supabase = createClient();
  const [kpi, setKpi] = useState<KPIValues>({
    headcount: null, avgAttendanceRate: null, avgProductivityScore: null,
    openTickets: null, pendingApprovals: null, overtimeCost: null,
    taskCompletionRate: null, turnoverRisk: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKPIs();
  }, []);

  const fetchKPIs = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [profilesRes, attendanceRes, ticketsRes, leavesRes, expensesRes, tasksRes] = await Promise.all([
        supabase.from('user_profiles').select('id', { count: 'exact' }).eq('is_active', true),
        supabase.from('attendance_records').select('user_id, status, overtime_hours').gte('work_date', monthStart).lte('work_date', monthEnd),
        supabase.from('support_tickets').select('id', { count: 'exact' }).in('status', ['open', 'in_progress']),
        supabase.from('leave_requests').select('id', { count: 'exact' }).eq('status', 'pending'),
        supabase.from('expenses').select('id', { count: 'exact' }).eq('status', 'pending'),
        supabase.from('tasks').select('id, status').gte('due_date', weekStart),
      ]);

      // Headcount
      const headcount = profilesRes.count ?? 0;

      // Avg attendance rate
      const records = attendanceRes.data || [];
      const workingRecords = records.filter((r) => !['weekend', 'holiday'].includes(r.status));
      const presentRecords = workingRecords.filter((r) => ['present', 'late', 'half_day', 'work_from_home'].includes(r.status));
      const avgAttendanceRate = workingRecords.length > 0
        ? Math.round((presentRecords.length / workingRecords.length) * 100)
        : null;

      // Overtime cost (hours * estimated hourly rate of 200 INR)
      const totalOvertimeHours = records.reduce((sum, r) => sum + (Number(r.overtime_hours) || 0), 0);
      const overtimeCost = Math.round(totalOvertimeHours * 200);

      // Productivity score (based on attendance)
      const avgProductivityScore = avgAttendanceRate !== null
        ? Math.round(avgAttendanceRate * 0.85)
        : null;

      // Open tickets
      const openTickets = (ticketsRes.count ?? 0);

      // Pending approvals (leaves + expenses)
      const pendingApprovals = (leavesRes.count ?? 0) + (expensesRes.count ?? 0);

      // Task completion rate
      const allTasks = tasksRes.data || [];
      const doneTasks = allTasks.filter((t) => t.status === 'done').length;
      const taskCompletionRate = allTasks.length > 0
        ? Math.round((doneTasks / allTasks.length) * 100)
        : null;

      // Turnover risk: employees with <50% attendance this month
      const userAttendanceMap: Record<string, { total: number; present: number }> = {};
      workingRecords.forEach((r) => {
        if (!userAttendanceMap[r.user_id]) userAttendanceMap[r.user_id] = { total: 0, present: 0 };
        userAttendanceMap[r.user_id].total++;
        if (['present', 'late', 'half_day', 'work_from_home'].includes(r.status)) {
          userAttendanceMap[r.user_id].present++;
        }
      });
      const turnoverRisk = Object.values(userAttendanceMap).filter(
        (u) => u.total >= 5 && (u.present / u.total) < 0.5
      ).length;

      setKpi({
        headcount, avgAttendanceRate, avgProductivityScore,
        openTickets, pendingApprovals, overtimeCost,
        taskCompletionRate, turnoverRisk,
      });
    } catch (err) {
      console.error('Analytics KPI fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    {
      id: 'akpi-headcount',
      label: t('totalHeadcount'),
      value: kpi.headcount !== null ? String(kpi.headcount) : '—',
      sub: t('activeEmployees'),
      icon: Users,
      trend: kpi.headcount !== null ? 'up' : 'neutral',
      colorClass: 'text-slate-900 dark:text-slate-100',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-attendance',
      label: t('avgAttendanceRate'),
      value: kpi.avgAttendanceRate !== null ? `${kpi.avgAttendanceRate}%` : '—',
      sub: t('last30Days'),
      icon: Clock,
      trend: kpi.avgAttendanceRate !== null ? (kpi.avgAttendanceRate >= 85 ? 'up' : 'down') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-productivity',
      label: t('avgProductivityScore'),
      value: kpi.avgProductivityScore !== null ? `${kpi.avgProductivityScore}%` : '—',
      sub: t('companyWide'),
      icon: Zap,
      trend: kpi.avgProductivityScore !== null ? (kpi.avgProductivityScore >= 70 ? 'up' : 'down') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-open-tickets',
      label: t('openTickets'),
      value: kpi.openTickets !== null ? String(kpi.openTickets) : '—',
      sub: t('noOpenTickets'),
      icon: AlertCircle,
      trend: kpi.openTickets !== null ? (kpi.openTickets === 0 ? 'up' : 'down') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-pending-approvals',
      label: t('pendingApprovals'),
      value: kpi.pendingApprovals !== null ? String(kpi.pendingApprovals) : '—',
      sub: t('noPendingApprovalsShort'),
      icon: ClipboardList,
      trend: kpi.pendingApprovals !== null ? (kpi.pendingApprovals === 0 ? 'up' : 'neutral') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-overtime-cost',
      label: t('overTimeCost'),
      value: kpi.overtimeCost !== null ? `₹${kpi.overtimeCost.toLocaleString()}` : '—',
      sub: t('currentMonth'),
      icon: Wallet,
      trend: 'neutral' as const,
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-task-completion',
      label: t('taskCompletionRate'),
      value: kpi.taskCompletionRate !== null ? `${kpi.taskCompletionRate}%` : '—',
      sub: t('thisWeek'),
      icon: CheckSquare,
      trend: kpi.taskCompletionRate !== null ? (kpi.taskCompletionRate >= 70 ? 'up' : 'down') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
    {
      id: 'akpi-turnover',
      label: t('turnoverRisk'),
      value: kpi.turnoverRisk !== null ? String(kpi.turnoverRisk) : '—',
      sub: t('employeesFlagged'),
      icon: UserX,
      trend: kpi.turnoverRisk !== null ? (kpi.turnoverRisk === 0 ? 'up' : 'down') : 'neutral',
      colorClass: 'text-slate-700 dark:text-slate-300',
      bgClass: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700',
      iconBg: 'bg-slate-100 dark:bg-slate-700',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
      {cards.map((card) => {
        const CardIcon = card.icon;
        const TrendIcon = card.trend === 'up' ? TrendingUp : card.trend === 'down' ? TrendingDown : Minus;
        const trendColor = card.trend === 'up' ? 'text-emerald-600' : card.trend === 'down' ? 'text-red-500' : 'text-slate-400 dark:text-slate-500';

        return (
          <div key={card.id} className={`rounded-xl border ${card.bgClass} p-5 shadow-sm relative overflow-hidden hover:shadow-card-hover transition-shadow duration-200`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-8 h-8 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                <CardIcon size={16} className={card.colorClass} />
              </div>
            </div>
            <p className={`text-2xl font-700 tabular-nums ${card.colorClass} leading-none mb-1`}>
              {loading ? '…' : card.value}
            </p>
            <p className="text-xs font-600 text-slate-700 dark:text-slate-300 leading-tight">{card.label}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{card.sub}</p>
            <div className={`flex items-center gap-1 mt-2 ${trendColor}`}>
              <TrendIcon size={11} />
              <span className="text-[11px] font-500">
                {loading ? t('awaitingData') : card.value === '—' ? t('awaitingData') : card.trend === 'up' ? '↑ Good' : card.trend === 'down' ? '↓ Needs attention' : '—'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
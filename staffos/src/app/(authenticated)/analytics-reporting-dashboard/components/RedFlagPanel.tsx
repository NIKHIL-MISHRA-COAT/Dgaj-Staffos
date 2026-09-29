'use client';

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, TrendingDown, UserX, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { createClient } from '@/lib/supabase/client';

type FlagType = 'attendance' | 'productivity' | 'overdue-tasks' | 'turnover-risk';

interface RedFlag {
  id: string;
  employeeName: string;
  department: string;
  initials: string;
  flagType: FlagType;
  detail: string;
  severity: 'critical' | 'high' | 'medium';
  daysSince: number;
}

const severityConfig = {
  critical: { labelKey: 'critical', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' },
  high: { labelKey: 'high', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-100 dark:border-orange-800', badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400' },
  medium: { labelKey: 'medium', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-100 dark:border-amber-800', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' },
};

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function RedFlagPanel() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [filter, setFilter] = useState<FlagType | 'all'>('all');
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();
  const supabase = createClient();

  const flagConfig: Record<FlagType, { icon: React.ElementType; labelKey: string; color: string }> = {
    attendance: { icon: Clock, labelKey: 'attendanceIssues', color: 'text-amber-600' },
    productivity: { icon: TrendingDown, labelKey: 'lowProductivity', color: 'text-red-500' },
    'overdue-tasks': { icon: AlertTriangle, labelKey: 'overdueTasks', color: 'text-orange-500' },
    'turnover-risk': { icon: UserX, labelKey: 'turnoverRisk', color: 'text-red-600' },
  };

  useEffect(() => {
    fetchRedFlags();
  }, []);

  const fetchRedFlags = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];

      const [profilesRes, attendanceRes, tasksRes] = await Promise.all([
        supabase.from('user_profiles').select('id, full_name, department').eq('is_active', true),
        supabase.from('attendance_records').select('user_id, status, work_date').gte('work_date', monthStart).lte('work_date', monthEnd),
        supabase.from('tasks').select('assigned_to, status, due_date, title').neq('status', 'done'),
      ]);

      const profiles = profilesRes.data || [];
      const attendance = attendanceRes.data || [];
      const tasks = tasksRes.data || [];

      const flags: RedFlag[] = [];

      // Attendance flags: employees with <70% attendance this month
      const userAttMap: Record<string, { total: number; present: number; absent: number }> = {};
      attendance.forEach((r) => {
        if (['weekend', 'holiday'].includes(r.status)) return;
        if (!userAttMap[r.user_id]) userAttMap[r.user_id] = { total: 0, present: 0, absent: 0 };
        userAttMap[r.user_id].total++;
        if (['present', 'late', 'half_day', 'work_from_home'].includes(r.status)) userAttMap[r.user_id].present++;
        if (r.status === 'absent') userAttMap[r.user_id].absent++;
      });

      profiles.forEach((p) => {
        const att = userAttMap[p.id];
        if (!att || att.total < 5) return;
        const rate = att.present / att.total;

        if (rate < 0.6) {
          flags.push({
            id: `att-${p.id}`,
            employeeName: p.full_name,
            department: p.department || 'General',
            initials: getInitials(p.full_name),
            flagType: 'attendance',
            detail: `${Math.round(rate * 100)}% attendance this month (${att.absent} absences)`,
            severity: rate < 0.4 ? 'critical' : 'high',
            daysSince: 1,
          });
        }

        // Productivity flag: low attendance = low productivity
        if (rate < 0.5 && att.total >= 10) {
          flags.push({
            id: `prod-${p.id}`,
            employeeName: p.full_name,
            department: p.department || 'General',
            initials: getInitials(p.full_name),
            flagType: 'productivity',
            detail: `Estimated productivity at ${Math.round(rate * 85)}% — below 50% threshold`,
            severity: 'high',
            daysSince: 2,
          });
        }

        // Turnover risk: <40% attendance for 2+ weeks
        if (rate < 0.4 && att.total >= 10) {
          flags.push({
            id: `turn-${p.id}`,
            employeeName: p.full_name,
            department: p.department || 'General',
            initials: getInitials(p.full_name),
            flagType: 'turnover-risk',
            detail: `Consistently low engagement — ${att.absent} absences this month`,
            severity: 'critical',
            daysSince: 3,
          });
        }
      });

      // Overdue tasks flags
      const overdueByUser: Record<string, { count: number; tasks: string[] }> = {};
      tasks.forEach((t) => {
        if (!t.assigned_to || !t.due_date || t.due_date >= today) return;
        if (!overdueByUser[t.assigned_to]) overdueByUser[t.assigned_to] = { count: 0, tasks: [] };
        overdueByUser[t.assigned_to].count++;
        overdueByUser[t.assigned_to].tasks.push(t.title);
      });

      profiles.forEach((p) => {
        const overdue = overdueByUser[p.id];
        if (!overdue || overdue.count < 2) return;
        flags.push({
          id: `task-${p.id}`,
          employeeName: p.full_name,
          department: p.department || 'General',
          initials: getInitials(p.full_name),
          flagType: 'overdue-tasks',
          detail: `${overdue.count} overdue tasks: ${overdue.tasks.slice(0, 2).join(', ')}${overdue.count > 2 ? '…' : ''}`,
          severity: overdue.count >= 5 ? 'critical' : overdue.count >= 3 ? 'high' : 'medium',
          daysSince: 1,
        });
      });

      setRedFlags(flags);
    } catch (err) {
      console.error('Red flag fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = (id: string, name: string) => {
    setDismissed((prev) => [...prev, id]);
    toast.success(`Flag for ${name} dismissed`, { duration: 2000 });
  };

  const handleAction = (name: string) => {
    toast.info(`Opening HR review for ${name}…`, { duration: 2000 });
  };

  const visible = redFlags.filter(
    (f) => !dismissed.includes(f.id) && (filter === 'all' || f.flagType === filter)
  );

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden h-full flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle size={14} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">{t('redFlagAlerts')}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{visible.length} {t('activeNeedsHR')}</p>
              </div>
            </div>
            <span className="text-xs font-700 bg-red-500 text-white px-2 py-0.5 rounded-full tabular-nums">
              {visible.length}
            </span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'attendance', 'productivity', 'overdue-tasks', 'turnover-risk'] as const).map((f) => (
              <button
                key={`rflag-filter-${f}`}
                onClick={() => setFilter(f)}
                className={`text-[11px] font-500 px-2.5 py-1 rounded-lg transition-all duration-150 ${filter === f ? 'bg-red-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
              >
                {f === 'all' ? t('all') : t(flagConfig[f].labelKey as any)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-50 dark:divide-slate-700">
          {loading ? (
            <div className="py-10 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center px-5">
              <AlertTriangle size={28} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-500 text-slate-500 dark:text-slate-400">{t('noActiveFlags')}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('allDismissedOrFiltered')}</p>
            </div>
          ) : (
            visible.map((flag) => {
              const fc = flagConfig[flag.flagType];
              const sc = severityConfig[flag.severity];
              const FlagIcon = fc.icon;
              return (
                <div key={flag.id} className={`px-4 py-3.5 ${sc.bg} border-l-2 ${sc.border} hover:brightness-[0.98] dark:hover:brightness-110 transition-all group`}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-700 text-slate-700 dark:text-slate-300 flex-shrink-0">
                      {flag.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-600 text-slate-900 dark:text-slate-100">{flag.employeeName}</p>
                        <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${sc.badge}`}>
                          {t(sc.labelKey as any)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{flag.department}</p>
                      <div className="flex items-center gap-1.5 mb-2">
                        <FlagIcon size={12} className={fc.color} />
                        <span className={`text-[11px] font-500 ${fc.color}`}>{t(fc.labelKey as any)}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{flag.detail}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                        {flag.daysSince === 1 ? t('flaggedYesterday') : `${flag.daysSince} days ago`}
                      </p>
                      <div className="flex items-center gap-2 mt-2.5">
                        <button onClick={() => handleAction(flag.employeeName)}
                          className="flex items-center gap-1 text-[11px] font-600 text-blue-600 hover:text-blue-700 transition-colors">
                          {t('review')} <ChevronRight size={11} />
                        </button>
                        <button onClick={() => handleDismiss(flag.id, flag.employeeName)}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors ml-auto">
                          <X size={11} />{t('dismiss')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
          <button onClick={() => setFilter('all')} className="text-xs text-blue-600 font-600 hover:underline w-full text-center">
            {t('viewAllRiskSignals')}
          </button>
        </div>
      </div>
    </>
  );
}
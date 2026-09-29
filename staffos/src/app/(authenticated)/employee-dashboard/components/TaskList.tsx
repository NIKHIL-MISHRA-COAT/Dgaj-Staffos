'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Square, AlertTriangle, RefreshCw, Building2, User, Calendar, Repeat, Tag, Clock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

// Unified task item — covers both regular tasks and recurring instances
interface UnifiedTask {
  id: string;
  title: string;
  priority: TaskPriority;
  status: string;
  due_date: string | null;
  due_time: string | null;
  assigned_by_name: string;
  assigned_to_name?: string;
  client_org_name?: string | null;
  organisation_relates_to?: string | null;
  task_type?: string | null;
  source: 'task' | 'recurring_instance';
  sequence_number?: number;
  recurring_task_id?: string;
  frequency?: string | null;
  assigned_to_dept?: string;
}

const priorityConfig: Record<TaskPriority, { label: string; color: string; dot: string; border: string }> = {
  critical: { label: 'Critical', color: 'text-red-600 bg-red-50 dark:bg-red-900/30', dot: 'bg-red-500', border: 'border-l-red-500' },
  high:     { label: 'High',     color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30', dot: 'bg-orange-500', border: 'border-l-orange-500' },
  medium:   { label: 'Medium',   color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30', dot: 'bg-amber-400', border: 'border-l-amber-400' },
  low:      { label: 'Low',      color: 'text-slate-500 bg-slate-100 dark:bg-slate-700', dot: 'bg-slate-400', border: 'border-l-slate-300' },
};

function getTaskTypeLabel(task: UnifiedTask): { label: string; color: string } {
  if (task.source === 'recurring_instance' || task.task_type === 'recurring' || task.frequency) {
    return { label: 'Recurring', color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20' };
  }
  if (task.task_type === 'additional') {
    return { label: 'Additional', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' };
  }
  return { label: 'One-Time', color: 'text-slate-500 bg-slate-100 dark:bg-slate-700' };
}

interface TaskCardProps {
  task: UnifiedTask;
  onComplete: (task: UnifiedTask) => void;
  completing: string | null;
}

function TaskCard({ task, onComplete, completing }: TaskCardProps) {
  const pc = priorityConfig[task.priority] || priorityConfig.medium;
  const typeInfo = getTaskTypeLabel(task);
  const isCompleting = completing === task.id;

  return (
    <div className={`px-4 sm:px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors border-l-2 ${pc.border}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onComplete(task)}
          disabled={isCompleting}
          className="mt-0.5 flex-shrink-0 text-slate-300 hover:text-emerald-500 transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center disabled:opacity-50"
          title="Mark as completed"
        >
          {isCompleting
            ? <div className="w-[18px] h-[18px] border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            : <Square size={18} />
          }
        </button>

        <div className="flex-1 min-w-0">
          {/* Task Name */}
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5 leading-snug">
            {task.title}
            {task.sequence_number && (
              <span className="ml-1.5 text-[10px] font-mono text-slate-400">#{task.sequence_number}</span>
            )}
          </p>

          {/* Row 1: Client + Org + Assigned By */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {task.client_org_name && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-md">
                <Building2 size={10} />{task.client_org_name}
              </span>
            )}
            {!task.client_org_name && task.organisation_relates_to && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-md">
                <Building2 size={10} />{task.organisation_relates_to}
              </span>
            )}
            {task.assigned_by_name && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <User size={10} />By: {task.assigned_by_name}
              </span>
            )}
          </div>

          {/* Row 2: Priority + Due Time + Task Type */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${pc.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pc.dot}`} />
              {pc.label}
            </span>
            {task.due_time && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Clock size={10} />
                {String(task.due_time).slice(0, 5)}
              </span>
            )}
            {task.due_date && !task.due_time && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Calendar size={10} />
                {task.due_date}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${typeInfo.color}`}>
              {task.source === 'recurring_instance' || task.task_type === 'recurring' ? <Repeat size={10} /> : <Tag size={10} />}
              {typeInfo.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaskList() {
  const [todayTasks, setTodayTasks] = useState<UnifiedTask[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<UnifiedTask[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();
  const { user, pinSession } = useAuth();
  const supabase = createClient();

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

  const fetchTasks = useCallback(async () => {
    const uid = getEffectiveUserId();
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      // ── Fetch today's regular tasks ──────────────────────────────────────────
      const { data: regularToday } = await supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, due_time, assigned_by_name, assigned_to_name, client_org_name, organisation_relates_to, task_type, assigned_to_dept')
        .or(`assigned_to.eq.${uid},assigned_user_ids.cs.{${uid}}`)
        .not('task_type', 'eq', 'recurring')
        .eq('due_date', today)
        .not('status', 'in', '("done","completed","cancelled")')
        .order('due_time', { ascending: true });

      // ── Fetch overdue regular tasks ──────────────────────────────────────────
      const { data: regularOverdue } = await supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, due_time, assigned_by_name, assigned_to_name, client_org_name, organisation_relates_to, task_type, assigned_to_dept')
        .or(`assigned_to.eq.${uid},assigned_user_ids.cs.{${uid}}`)
        .not('task_type', 'eq', 'recurring')
        .lt('due_date', today)
        .not('status', 'in', '("done","completed","cancelled")')
        .order('due_date', { ascending: true });

      // ── Fetch today's recurring instances ────────────────────────────────────
      const { data: recurringToday } = await supabase
        .from('recurring_task_instances')
        .select('id, task_name, priority, status, due_date, due_time, is_overdue, sequence_number, recurring_task_id, client_org_name, organisation_relates_to, frequency, assigned_to_name, assigned_to_dept')
        .eq('assigned_to', uid)
        .eq('due_date', today)
        .not('status', 'in', '("completed","cancelled")')
        .order('due_time', { ascending: true });

      // ── Fetch overdue recurring instances ────────────────────────────────────
      const { data: recurringOverdue } = await supabase
        .from('recurring_task_instances')
        .select('id, task_name, priority, status, due_date, due_time, is_overdue, sequence_number, recurring_task_id, client_org_name, organisation_relates_to, frequency, assigned_to_name, assigned_to_dept')
        .eq('assigned_to', uid)
        .lt('due_date', today)
        .not('status', 'in', '("completed","cancelled")')
        .order('due_date', { ascending: true });

      const mapRegular = (task: any): UnifiedTask => ({
        id: task.id,
        title: task.title || 'Task',
        priority: task.priority || 'medium',
        status: task.status || 'pending',
        due_date: task.due_date,
        due_time: task.due_time || null,
        assigned_by_name: task.assigned_by_name || '',
        assigned_to_name: task.assigned_to_name || '',
        client_org_name: task.client_org_name || null,
        organisation_relates_to: task.organisation_relates_to || null,
        task_type: task.task_type || 'one-time',
        source: 'task',
        assigned_to_dept: task.assigned_to_dept || '',
      });

      const mapRecurring = (inst: any): UnifiedTask => ({
        id: inst.id,
        title: inst.task_name || 'Recurring Task',
        priority: inst.priority || 'medium',
        status: inst.status || 'pending',
        due_date: inst.due_date,
        due_time: inst.due_time || null,
        assigned_by_name: '',
        assigned_to_name: inst.assigned_to_name || '',
        client_org_name: inst.client_org_name || null,
        organisation_relates_to: inst.organisation_relates_to || null,
        task_type: 'recurring',
        source: 'recurring_instance',
        sequence_number: inst.sequence_number,
        recurring_task_id: inst.recurring_task_id,
        frequency: inst.frequency || null,
        assigned_to_dept: inst.assigned_to_dept || '',
      });

      const todayList: UnifiedTask[] = [
        ...(regularToday || []).map(mapRegular),
        ...(recurringToday || []).map(mapRecurring),
      ];

      const overdueList: UnifiedTask[] = [
        ...(regularOverdue || []).map(mapRegular),
        ...(recurringOverdue || []).map(mapRecurring),
      ];

      // Sort overdue: oldest first
      overdueList.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      });

      setTodayTasks(todayList);
      setOverdueTasks(overdueList);
    } catch (err) {
      console.error('Task fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, pinSession?.userId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // ── Real-time subscription to recurring_task_instances ──────────────────────
  useEffect(() => {
    const uid = getEffectiveUserId();
    if (!uid) return;

    const channel = supabase
      .channel('tasklist-recurring-instances')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recurring_task_instances',
          filter: `assigned_to=eq.${uid}`,
        },
        () => {
          // Re-fetch on any INSERT, UPDATE, or DELETE for this user's instances
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, pinSession?.userId, fetchTasks]);

  const handleComplete = async (task: UnifiedTask) => {
    setCompleting(task.id);
    try {
      const now = new Date().toISOString();
      if (task.source === 'recurring_instance') {
        const { error } = await supabase
          .from('recurring_task_instances')
          .update({
            status: 'completed',
            is_overdue: false,
            completion_datetime: now,
            updated_at: now,
          })
          .eq('id', task.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tasks')
          .update({
            status: 'done',
            updated_at: now,
          })
          .eq('id', task.id);
        if (error) throw error;
      }

      setCompletedIds(prev => new Set([...prev, task.id]));
      toast.success(`"${task.title}" completed!`, { duration: 2500 });

      // Remove from lists after brief delay to show completion
      setTimeout(() => {
        setTodayTasks(prev => prev.filter(t => t.id !== task.id));
        setOverdueTasks(prev => prev.filter(t => t.id !== task.id));
        setCompletedIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
      }, 800);
    } catch {
      toast.error('Failed to complete task. Please try again.');
    } finally {
      setCompleting(null);
    }
  };

  const totalCount = todayTasks.length + overdueTasks.length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-slate-100 dark:border-slate-700">
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">{t('myTasks')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {loading ? '…' : totalCount === 0 ? 'All caught up!' : `${totalCount} task${totalCount !== 1 ? 's' : ''} pending`}
            {overdueTasks.length > 0 && (
              <span className="ml-2 text-red-600 font-semibold">· {overdueTasks.length} overdue</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTasks}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : totalCount === 0 ? (
        <div className="py-12 text-center px-4">
          <CheckCircle2 size={36} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">All tasks completed!</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">No pending or overdue tasks for today.</p>
        </div>
      ) : (
        <div>
          {/* ── TODAY'S TASKS ─────────────────────────────────────────────── */}
          <div>
            <div className="px-4 sm:px-5 py-2.5 bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Calendar size={13} className="text-blue-500" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                  Today's Tasks
                </span>
                <span className="ml-auto text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
                  {todayTasks.length}
                </span>
              </div>
            </div>

            {todayTasks.length === 0 ? (
              <div className="px-5 py-5 text-center">
                <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">No tasks due today</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {todayTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={handleComplete}
                    completing={completing}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── OVERDUE TASKS ─────────────────────────────────────────────── */}
          {overdueTasks.length > 0 && (
            <div className="border-t-2 border-red-100 dark:border-red-900/30">
              <div className="px-4 sm:px-5 py-2.5 bg-red-50/60 dark:bg-red-900/20 border-b border-red-100 dark:border-red-900/30">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} className="text-red-500" />
                  <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">
                    Overdue Tasks
                  </span>
                  <span className="ml-auto text-xs font-semibold text-red-600 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
                    {overdueTasks.length}
                  </span>
                </div>
                <p className="text-[11px] text-red-500 dark:text-red-400 mt-0.5">
                  Sorted oldest first · Complete to remove from this list
                </p>
              </div>

              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {overdueTasks.map(task => (
                  <div key={task.id} className="relative">
                    {/* Overdue date badge */}
                    <div className="absolute top-3.5 right-4 flex items-center gap-1 text-[10px] font-semibold text-red-500">
                      <AlertTriangle size={9} />
                      {task.due_date}
                    </div>
                    <TaskCard
                      task={task}
                      onComplete={handleComplete}
                      completing={completing}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 sm:px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {todayTasks.length} today · {overdueTasks.length} overdue
        </p>
        <Link href="/task-management">
          <button className="flex items-center gap-1 text-xs text-blue-600 font-semibold hover:underline">
            {t('viewAll')} <ArrowRight size={12} />
          </button>
        </Link>
      </div>
    </div>
  );
}
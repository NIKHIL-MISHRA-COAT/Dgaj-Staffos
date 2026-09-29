'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Clock, Flag, Repeat, Users, Calendar, Loader2, RefreshCw, Plus, ArrowRight, TrendingUp, CheckSquare, Zap, BarChart3, ArrowLeft } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';


type TaskStatus = 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'completed' | 'cancelled';
type Priority = 'critical' | 'high' | 'medium' | 'low';

interface Task {
  id: string;
  title: string;
  task_status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  is_blocked: boolean;
  is_recurring: boolean;
  completion_percentage: number;
  assignee_name?: string;
  category_name?: string;
  client_org_name?: string;
  creator_id: string | null;
  assigned_to: string | null;
  is_collaborator?: boolean;
  created_at: string;
  completed_at: string | null;
  estimated_hours: number;
}

interface KPIs {
  dueToday: number;
  overdue: number;
  dueNext7: number;
  completedThisWeek: number;
  urgentHigh: number;
  blocked: number;
  completionRate: number;
  onTimeRate: number;
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; dot: string }> = {
  not_started: { label: 'Not Started', color: 'text-slate-600', bg: 'bg-slate-100 dark:bg-slate-700', dot: 'bg-slate-400' },
  in_progress:  { label: 'In Progress', color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/30',  dot: 'bg-blue-500' },
  waiting:      { label: 'Waiting',     color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/30', dot: 'bg-amber-400' },
  blocked:      { label: 'Blocked',     color: 'text-red-600',   bg: 'bg-red-50 dark:bg-red-900/30',    dot: 'bg-red-500' },
  completed:    { label: 'Completed',   color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/30', dot: 'bg-emerald-500' },
  cancelled:    { label: 'Cancelled',   color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800',  dot: 'bg-slate-300' },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Urgent',  color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/30' },
  high:     { label: 'High',    color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/30' },
  medium:   { label: 'Medium',  color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/30' },
  low:      { label: 'Low',     color: 'text-slate-500',  bg: 'bg-slate-100 dark:bg-slate-700' },
};

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatPct(n: number): string {
  return isNaN(n) || !isFinite(n) ? '0.00%' : n.toFixed(2) + '%';
}

function getDayLabel(date: Date, today: Date): string {
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return `Today — ${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (diff === 1) return `Tomorrow — ${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function isOverdue(task: Task, today: string): boolean {
  if (task.task_status === 'completed' || task.task_status === 'cancelled') return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}

interface TaskCardProps {
  task: Task;
  onStatusChange: (id: string, status: TaskStatus) => void;
  currentUserId: string;
}

function TaskCard({ task, onStatusChange, currentUserId }: TaskCardProps) {
  const sc = STATUS_CONFIG[task.task_status] || STATUS_CONFIG.not_started;
  const pc = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const today = new Date().toISOString().split('T')[0];
  const overdue = isOverdue(task, today);

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-colors hover:shadow-sm ${
      overdue ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10' : task.is_blocked ?'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/10': 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
    }`}>
      <button
        onClick={() => onStatusChange(task.id, task.task_status === 'completed' ? 'not_started' : 'completed')}
        className="mt-0.5 flex-shrink-0 transition-colors"
      >
        {task.task_status === 'completed'
          ? <CheckCircle2 size={18} className="text-emerald-500" />
          : <Circle size={18} className="text-slate-300 hover:text-blue-400" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium leading-snug ${task.task_status === 'completed' ? 'line-through text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {overdue && <AlertTriangle size={12} className="text-red-500" />}
            {task.is_blocked && <Flag size={12} className="text-orange-500" />}
            {task.is_recurring && <Repeat size={12} className="text-purple-400" />}
            {task.is_collaborator && <Users size={12} className="text-blue-400" title="Collaborating" />}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.color}`}>{pc.label}</span>
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${sc.bg} ${sc.color}`}>
            <span className={`w-1 h-1 rounded-full ${sc.dot}`} />
            {sc.label}
          </span>
          {task.due_time && (
            <span className={`flex items-center gap-0.5 text-[10px] ${overdue ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
              <Clock size={10} />{task.due_time.slice(0,5)}
            </span>
          )}
          {task.client_org_name && task.client_org_name !== '—' && (
            <span className="text-[10px] text-slate-400 truncate max-w-[100px]">{task.client_org_name}</span>
          )}
          {task.is_collaborator && (
            <span className="text-[10px] text-blue-500 font-medium">Collaborating</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyTasks() {
  const { effectiveUserId, pinSession } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIs>({
    dueToday: 0, overdue: 0, dueNext7: 0, completedThisWeek: 0,
    urgentHigh: 0, blocked: 0, completionRate: 0, onTimeRate: 0,
  });

  const fetchTasks = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      // Fetch assigned tasks
      const { data: assignedTasks } = await supabase
        .from('tasks')
        .select(`id, title, task_status, priority, due_date, due_time, start_date,
          is_blocked, is_recurring, completion_percentage, creator_id, assigned_to,
          created_at, completed_at, estimated_hours, client_org_id,
          task_categories(name), client_organisations(name)`)
        .eq('assigned_to', effectiveUserId)
        .eq('is_recurring', false)
        .not('task_status', 'eq', 'cancelled');

      // Fetch collaborating tasks
      const { data: collabLinks } = await supabase
        .from('task_collaborators')
        .select('task_id')
        .eq('user_id', effectiveUserId);

      const collabTaskIds = (collabLinks || []).map((c: any) => c.task_id);
      let collabTasks: any[] = [];
      if (collabTaskIds.length > 0) {
        const { data } = await supabase
          .from('tasks')
          .select(`id, title, task_status, priority, due_date, due_time, start_date,
            is_blocked, is_recurring, completion_percentage, creator_id, assigned_to,
            created_at, completed_at, estimated_hours, client_org_id,
            task_categories(name), client_organisations(name)`)
          .in('id', collabTaskIds)
          .eq('is_recurring', false)
          .not('task_status', 'eq', 'cancelled');
        collabTasks = (data || []).filter((t: any) => t.assigned_to !== effectiveUserId);
      }

      const allTasks: Task[] = [
        ...(assignedTasks || []).map((t: any) => ({
          ...t,
          category_name: t.task_categories?.name || '—',
          client_org_name: t.client_organisations?.name || '—',
          is_collaborator: false,
        })),
        ...collabTasks.map((t: any) => ({
          ...t,
          category_name: t.task_categories?.name || '—',
          client_org_name: t.client_organisations?.name || '—',
          is_collaborator: true,
        })),
      ];

      setTasks(allTasks);

      // Calculate KPIs
      const today = new Date().toISOString().split('T')[0];
      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const next7 = new Date(); next7.setDate(next7.getDate() + 7);
      const next7Str = next7.toISOString().split('T')[0];

      const active = allTasks.filter(t => t.task_status !== 'completed' && t.task_status !== 'cancelled');
      const completed = allTasks.filter(t => t.task_status === 'completed');
      const overdueList = allTasks.filter(t => isOverdue(t, today));
      const completedOnTime = completed.filter(t => t.completed_at && t.due_date && t.completed_at.split('T')[0] <= t.due_date);

      setKpis({
        dueToday: active.filter(t => t.due_date === today).length,
        overdue: overdueList.length,
        dueNext7: active.filter(t => t.due_date && t.due_date > today && t.due_date <= next7Str).length,
        completedThisWeek: completed.filter(t => t.completed_at && t.completed_at >= weekStartStr).length,
        urgentHigh: active.filter(t => t.priority === 'critical' || t.priority === 'high').length,
        blocked: active.filter(t => t.is_blocked).length,
        completionRate: allTasks.length > 0 ? (completed.length / allTasks.length) * 100 : 0,
        onTimeRate: completed.length > 0 ? (completedOnTime.length / completed.length) * 100 : 0,
      });
    } catch (err: any) {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleStatusChange = async (id: string, status: TaskStatus) => {
    try {
      const updates: any = { task_status: status };
      if (status === 'completed') updates.completed_at = new Date().toISOString();
      await supabase.from('tasks').update(updates).eq('id', id);
      setTasks(ts => ts.map(t => t.id === id ? { ...t, task_status: status, completed_at: status === 'completed' ? new Date().toISOString() : t.completed_at } : t));
      toast.success(status === 'completed' ? 'Task completed!' : 'Task reopened');
    } catch { toast.error('Failed to update task'); }
  };

  // Build 7-day view
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const todayStr = today.toISOString().split('T')[0];
  const overdueTasks = tasks.filter(t => isOverdue(t, todayStr) && t.task_status !== 'completed');

  const getTasksForDay = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return tasks.filter(t => t.due_date === dateStr && t.task_status !== 'completed' && t.task_status !== 'cancelled')
      .sort((a, b) => {
        if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
        if (a.due_time) return -1;
        if (b.due_time) return 1;
        return 0;
      });
  };

  const kpiCards = [
    { label: 'Due Today', value: kpis.dueToday, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: Calendar },
    { label: 'Overdue', value: kpis.overdue, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: AlertTriangle },
    { label: 'Next 7 Days', value: kpis.dueNext7, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: Clock },
    { label: 'Done This Week', value: kpis.completedThisWeek, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: CheckCircle2 },
    { label: 'Urgent / High', value: kpis.urgentHigh, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: Zap },
    { label: 'Blocked', value: kpis.blocked, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20', icon: Flag },
    { label: 'Completion Rate', value: formatPct(kpis.completionRate), color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon: BarChart3 },
    { label: 'On-Time Rate', value: formatPct(kpis.onTimeRate), color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-900/20', icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="Go back">
              <ArrowLeft size={16} />
            </button>
            <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">My Tasks</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Your personal task view — next 7 days</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchTasks} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <Link href="/all-tasks"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              All Tasks <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-blue-500" />
          </div>
        ) : (
          <>
            {/* KPI Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {kpiCards.map(k => {
                const Icon = k.icon;
                return (
                  <div key={k.label} className={`${k.bg} rounded-xl p-3 border border-transparent`}>
                    <div className="flex items-center justify-between mb-1">
                      <Icon size={14} className={k.color} />
                    </div>
                    <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{k.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Needs Attention */}
            {(kpis.overdue > 0 || kpis.dueToday > 0 || kpis.blocked > 0 || kpis.urgentHigh > 0) && (
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} /> Needs Attention
                </h3>
                <div className="flex flex-wrap gap-2">
                  {kpis.overdue > 0 && (
                    <span className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm font-medium">
                      {kpis.overdue} Overdue
                    </span>
                  )}
                  {kpis.dueToday > 0 && (
                    <span className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm font-medium">
                      {kpis.dueToday} Due Today
                    </span>
                  )}
                  {kpis.urgentHigh > 0 && (
                    <span className="px-3 py-1.5 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-sm font-medium">
                      {kpis.urgentHigh} Urgent/High
                    </span>
                  )}
                  {kpis.blocked > 0 && (
                    <span className="px-3 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-sm font-medium">
                      {kpis.blocked} Blocked
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Overdue section */}
            {overdueTasks.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-red-600 dark:text-red-400 mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} /> Overdue ({overdueTasks.length})
                </h3>
                <div className="space-y-2">
                  {overdueTasks.map(task => (
                    <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} currentUserId={effectiveUserId || ''} />
                  ))}
                </div>
              </div>
            )}

            {/* 7-Day View */}
            <div className="space-y-5">
              {days.map((day, i) => {
                const dayTasks = getTasksForDay(day);
                const isToday = i === 0;
                return (
                  <div key={day.toISOString()}>
                    <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${isToday ? 'border-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-700'}`}>
                      <h3 className={`text-sm font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {getDayLabel(day, today)}
                      </h3>
                      {dayTasks.length > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isToday ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                          {dayTasks.length}
                        </span>
                      )}
                    </div>
                    {dayTasks.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-500 py-2 pl-1">No tasks scheduled</p>
                    ) : (
                      <div className="space-y-2">
                        {dayTasks.map(task => (
                          <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} currentUserId={effectiveUserId || ''} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Empty state */}
            {tasks.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <CheckSquare size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-base font-medium">You're all caught up!</p>
                <p className="text-sm mt-1">No tasks are scheduled for the next 7 days.</p>
                <Link href="/all-tasks" className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                  <Plus size={14} /> Create a Task
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

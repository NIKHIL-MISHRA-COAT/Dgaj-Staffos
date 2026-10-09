'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, AlertTriangle, Repeat } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

type Priority = 'critical' | 'high' | 'medium' | 'low';

interface Item {
  id: string;
  title: string;
  priority: Priority;
  due_date: string;
  due_time: string | null;
  frequency: string | null; // daily | weekly | monthly | quarterly | yearly, or null for one-time
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-300',
};

const MAX_TODAY = 5;
const MAX_LATER = 4;

// Local date as YYYY-MM-DD (avoids the UTC shift of toISOString in India)
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};

function laterTag(item: Item, tomorrow: string, weekEnd: string): string {
  const f = (item.frequency || '').toLowerCase();
  if (f === 'yearly') return 'Yearly';
  if (f === 'quarterly') return 'Quarterly';
  if (f === 'monthly') return 'Monthly';
  if (item.due_date === tomorrow) return 'Tomorrow';
  if (item.due_date <= weekEnd) return 'This week';
  return 'Later';
}

export default function TodayTasksBox() {
  const { user, pinSession } = useAuth();
  const supabase = createClient();
  const [today, setToday] = useState<Item[]>([]);
  const [later, setLater] = useState<Item[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const getEffectiveUserId = (): string | null => {
    if (user?.id) return user.id;
    if (pinSession?.userId) return pinSession.userId;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) return JSON.parse(stored)?.userId || null;
    } catch {}
    return null;
  };

  useEffect(() => {
    const uid = getEffectiveUserId();
    if (!uid) {
      setLoading(false);
      return;
    }
    fetchTasks(uid);
  }, [user?.id, pinSession?.userId]);

  const fetchTasks = async (uid: string) => {
    setLoading(true);
    try {
      const now = new Date();
      const todayStr = ymd(now);
      const tomorrowStr = ymd(addDays(now, 1));
      const weekEndStr = ymd(addDays(now, 7));
      const horizonStr = ymd(addDays(now, 90));

      // One-time tasks the person owns or collaborates on
      const { data: collabLinks } = await supabase
        .from('task_collaborators')
        .select('task_id')
        .eq('user_id', uid);
      const collabIds = (collabLinks || []).map((c: any) => c.task_id);

      const taskCols = 'id, title, priority, task_status, due_date, due_time';
      const [assignedRes, collabRes, instancesRes] = await Promise.all([
        supabase
          .from('tasks')
          .select(taskCols)
          .eq('assigned_to', uid)
          .not('task_status', 'in', '(completed,cancelled)')
          .not('due_date', 'is', null)
          .lte('due_date', horizonStr),
        collabIds.length > 0
          ? supabase
              .from('tasks')
              .select(taskCols)
              .in('id', collabIds)
              .not('task_status', 'in', '(completed,cancelled)')
              .not('due_date', 'is', null)
              .lte('due_date', horizonStr)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('recurring_task_instances')
          .select('id, task_name, priority, status, due_date, due_time, recurring_tasks(title, frequency)')
          .eq('assigned_to', uid)
          .not('status', 'in', '(completed,cancelled)')
          .lte('due_date', horizonStr),
      ]);

      // Merge (de-duplicate tasks reached both ways)
      const all: Item[] = [];
      const seen = new Set<string>();
      for (const t of [...(assignedRes.data || []), ...((collabRes as any).data || [])]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        all.push({
          id: t.id,
          title: t.title || 'Task',
          priority: (t.priority as Priority) || 'medium',
          due_date: t.due_date,
          due_time: t.due_time || null,
          frequency: null,
        });
      }
      for (const i of instancesRes.data || []) {
        all.push({
          id: `rec-${i.id}`,
          title: i.task_name || i.recurring_tasks?.title || 'Recurring task',
          priority: (i.priority as Priority) || 'medium',
          due_date: i.due_date,
          due_time: i.due_time || null,
          frequency: i.recurring_tasks?.frequency || 'daily',
        });
      }

      const overdue = all.filter((i) => i.due_date < todayStr).length;

      const todayItems = all
        .filter((i) => i.due_date === todayStr)
        .sort((a, b) => (a.due_time || '99:99').localeCompare(b.due_time || '99:99'));

      // Urgent later: critical/high priority, or any monthly/quarterly/yearly recurring task
      const laterItems = all
        .filter((i) => i.due_date > todayStr)
        .filter((i) => {
          const f = (i.frequency || '').toLowerCase();
          const recurringBig = ['monthly', 'quarterly', 'yearly'].includes(f);
          return recurringBig || i.priority === 'critical' || i.priority === 'high';
        })
        .sort((a, b) => a.due_date.localeCompare(b.due_date));

      setOverdueCount(overdue);
      setToday(todayItems);
      setLater(laterItems);
    } catch (err) {
      console.error('Today tasks fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const now = new Date();
  const tomorrowStr = ymd(addDays(now, 1));
  const weekEndStr = ymd(addDays(now, 7));

  const shownToday = today.slice(0, MAX_TODAY);
  const shownLater = later.slice(0, MAX_LATER);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm sm:text-base font-600 text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ClipboardList size={16} className="text-blue-600" /> Today&apos;s Tasks
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {loading ? 'Loading…' : `${today.length} due today`}
            {!loading && overdueCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-600">
                <AlertTriangle size={11} /> {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
        <Link href="/my-tasks" className="text-xs font-600 text-blue-600 hover:text-blue-700 whitespace-nowrap">
          View all
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-16">
          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {shownToday.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-2">Nothing due today.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {shownToday.map((i) => (
                <li key={i.id} className="flex items-center gap-2.5 py-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[i.priority] || PRIORITY_DOT.medium}`} />
                  <span className="flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-200 truncate">{i.title}</span>
                  {i.frequency && <Repeat size={11} className="text-purple-500 flex-shrink-0" />}
                  {i.due_time && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums flex-shrink-0">
                      {String(i.due_time).slice(0, 5)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {today.length > MAX_TODAY && (
            <p className="text-[11px] text-slate-400 mt-1">+{today.length - MAX_TODAY} more today</p>
          )}

          {later.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <p className="text-[11px] font-600 uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                Urgent later
              </p>
              <ul className="space-y-1.5">
                {shownLater.map((i) => (
                  <li key={i.id} className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[i.priority] || PRIORITY_DOT.medium}`} />
                    <span className="flex-1 min-w-0 text-xs text-slate-700 dark:text-slate-300 truncate">{i.title}</span>
                    <span className="text-[10px] font-600 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {laterTag(i, tomorrowStr, weekEndStr)}
                    </span>
                  </li>
                ))}
              </ul>
              {later.length > MAX_LATER && (
                <p className="text-[11px] text-slate-400 mt-1">+{later.length - MAX_LATER} more</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
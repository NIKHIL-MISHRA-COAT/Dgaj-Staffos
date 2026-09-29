'use client';

import React, { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { createClient } from '@/lib/supabase/client';

interface TaskStats {
  name: string;
  value: number;
  fill: string;
}

export default function TaskCompletionRadial() {
  const supabase = createClient();
  const [stats, setStats] = useState<TaskStats[]>([]);
  const [completionRate, setCompletionRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('tasks')
        .select('status')
        .gte('due_date', weekStart);

      if (error) throw error;

      const tasks = data || [];
      const counts = {
        done: tasks.filter((t) => t.status === 'done').length,
        'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
        todo: tasks.filter((t) => t.status === 'todo').length,
        overdue: tasks.filter((t) => t.status === 'overdue').length,
      };

      const total = tasks.length;
      const rate = total > 0 ? Math.round((counts.done / total) * 100) : null;
      setCompletionRate(rate);

      if (total > 0) {
        setStats([
          { name: 'Done', value: counts.done, fill: '#10b981' },
          { name: 'In Progress', value: counts['in-progress'], fill: '#3b82f6' },
          { name: 'To Do', value: counts.todo, fill: '#94a3b8' },
          { name: 'Overdue', value: counts.overdue, fill: '#ef4444' },
        ].filter((s) => s.value > 0));
      }
    } catch (err) {
      console.error('Task completion fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasData = stats.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5 h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">Task Completion</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">This week</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : !hasData ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CheckSquare size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-500 text-slate-500 dark:text-slate-400">No task data yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Task completion stats will appear once tasks are created</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center">
          {completionRate !== null && (
            <div className="text-center mb-2">
              <p className="text-3xl font-700 text-emerald-600">{completionRate}%</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">completion rate</p>
            </div>
          )}
          <ResponsiveContainer width="100%" height={160}>
            <RadialBarChart cx="50%" cy="50%" innerRadius="30%" outerRadius="90%" data={stats} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="value" cornerRadius={4} />
              <Tooltip formatter={(value: number, name: string) => [`${value} tasks`, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
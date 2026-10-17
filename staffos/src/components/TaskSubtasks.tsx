'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

// Subtasks of one normal task: each has its own title and status (no assignee or deadline).
interface Subtask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  sort_order: number;
}

const inputCls = 'w-full border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300';

export default function TaskSubtasks({ taskId, readOnly = false }: { taskId: string; readOnly?: boolean }) {
  const supabase = createClient();
  const [items, setItems] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_subtasks')
      .select('id, title, status, sort_order')
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) toast.error(`Could not load subtasks: ${error.message}`);
    setItems((data || []) as Subtask[]);
    setLoading(false);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // Each subtask has its own status, independent of the others and of the parent task
  const setStatus = async (s: Subtask, status: Subtask['status']) => {
    setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, status } : x)));
    const { error } = await supabase
      .from('task_subtasks')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('id', s.id);
    if (error) { toast.error('Could not update subtask'); load(); }
  };

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('task_subtasks').insert({
      task_id: taskId,
      title: title.trim(),
      sort_order: items.length,
    });
    setBusy(false);
    if (error) { toast.error(`Could not add subtask: ${error.message}`); return; }
    setTitle('');
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('task_subtasks').delete().eq('id', id);
    if (error) toast.error('Could not delete subtask'); else load();
  };

  const doneCount = items.filter((i) => i.status === 'completed').length;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        Subtasks{items.length > 0 && <span className="text-slate-400 font-normal"> · {doneCount}/{items.length} done</span>}
      </p>

      {loading ? (
        <Loader2 size={14} className="animate-spin text-slate-400" />
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-400">No subtasks yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <select
                value={s.status}
                onChange={(e) => setStatus(s, e.target.value as Subtask['status'])}
                disabled={readOnly}
                className="border border-slate-200 dark:border-slate-600 rounded-md px-1.5 py-0.5 text-[11px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                aria-label="Subtask status"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
              <span className={`flex-1 min-w-0 truncate ${s.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {s.title}
              </span>
              {!readOnly && (
                <button onClick={() => remove(s.id)} className="text-slate-400 hover:text-red-500" aria-label="Delete subtask">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex gap-2">
          <input className={`${inputCls} flex-1`} placeholder="Add a subtask" value={title}
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button onClick={add} disabled={busy || !title.trim()}
            className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold px-3">
            {busy ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}
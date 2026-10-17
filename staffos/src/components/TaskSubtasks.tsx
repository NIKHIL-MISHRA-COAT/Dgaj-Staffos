'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

// Subtasks of one normal task: each has its own title, assignee, due date and tick.
interface Subtask {
  id: string;
  title: string;
  assigned_to: string | null;
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  sort_order: number;
}
interface Person { id: string; full_name: string; }

const inputCls = 'w-full border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1.5 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300';

export default function TaskSubtasks({ taskId, readOnly = false }: { taskId: string; readOnly?: boolean }) {
  const supabase = createClient();
  const [items, setItems] = useState<Subtask[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_subtasks')
      .select('id, title, assigned_to, due_date, status, sort_order')
      .eq('task_id', taskId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) toast.error(`Could not load subtasks: ${error.message}`);
    setItems((data || []) as Subtask[]);
    setLoading(false);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('user_profiles').select('id, full_name').order('full_name')
      .then(({ data }) => setPeople((data || []) as Person[]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (s: Subtask) => {
    const nowDone = s.status !== 'completed';
    const status: Subtask['status'] = nowDone ? 'completed' : 'pending';
    setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, status } : x)));
    const { error } = await supabase
      .from('task_subtasks')
      .update({ status, completed_at: nowDone ? new Date().toISOString() : null })
      .eq('id', s.id);
    if (error) { toast.error('Could not update subtask'); load(); }
  };

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('task_subtasks').insert({
      task_id: taskId,
      title: title.trim(),
      assigned_to: assignee || null,
      due_date: due || null,
      sort_order: items.length,
    });
    setBusy(false);
    if (error) { toast.error(`Could not add subtask: ${error.message}`); return; }
    setTitle(''); setAssignee(''); setDue('');
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('task_subtasks').delete().eq('id', id);
    if (error) toast.error('Could not delete subtask'); else load();
  };

  const doneCount = items.filter((i) => i.status === 'completed').length;
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name || '';

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
              <input
                type="checkbox"
                checked={s.status === 'completed'}
                onChange={() => toggle(s)}
                disabled={readOnly}
                className="cursor-pointer"
              />
              <span className={`flex-1 min-w-0 truncate ${s.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {s.title}
              </span>
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {[nameOf(s.assigned_to), s.due_date].filter(Boolean).join(' · ')}
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
        <div className="grid grid-cols-12 gap-2">
          <input className={`${inputCls} col-span-5`} placeholder="Add a subtask" value={title}
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <select className={`${inputCls} col-span-3`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Assign to…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <input type="date" className={`${inputCls} col-span-2`} value={due} onChange={(e) => setDue(e.target.value)} />
          <button onClick={add} disabled={busy || !title.trim()}
            className="col-span-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold">
            {busy ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}
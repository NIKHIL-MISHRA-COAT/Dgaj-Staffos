'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, Download, RefreshCw, CheckSquare, Square, AlertTriangle, Repeat, X, Users, Flag, Loader2, ArrowUpDown, SlidersHorizontal, ArrowLeft } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type TaskStatus = 'not_started' | 'in_progress' | 'waiting' | 'blocked' | 'completed' | 'cancelled';
type Priority = 'critical' | 'high' | 'medium' | 'low';

interface Task {
  id: string;
  title: string;
  description: string;
  task_status: TaskStatus;
  priority: Priority;
  category_id: string | null;
  category_name?: string;
  assigned_to: string | null;
  assignee_name?: string;
  creator_id: string | null;
  creator_name?: string;
  client_org_id: string | null;
  client_org_name?: string;
  organisation_id: string | null;
  project_id: string | null;
  project_name?: string;
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_hours: number;
  actual_hours: number;
  completion_percentage: number;
  is_recurring: boolean;
  is_blocked: boolean;
  is_overdue: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  collaborators?: { user_id: string; full_name: string }[];
}

interface UserProfile { id: string; full_name: string; role: string; }
interface Category { id: string; name: string; color: string; }
interface ClientOrg { id: string; name: string; }
interface Project { id: string; name: string; }

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

function fmt(d: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; }
}

function isOverdue(task: Task): boolean {
  if (task.task_status === 'completed' || task.task_status === 'cancelled') return false;
  if (!task.due_date) return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

interface CreateTaskModalProps {
  onClose: () => void;
  onCreated: () => void;
  users: UserProfile[];
  categories: Category[];
  clients: ClientOrg[];
  projects: Project[];
  currentUserId: string;
  isManager: boolean;
}

function CreateTaskModal({ onClose, onCreated, users, categories, clients, projects, currentUserId, isManager }: CreateTaskModalProps) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', task_status: 'not_started' as TaskStatus,
    priority: 'medium' as Priority, category_id: '', assigned_to: currentUserId,
    client_org_id: '', project_id: '', start_date: '', start_time: '',
    due_date: '', due_time: '', estimated_hours: '', collaborators: [] as string[],
    is_blocked: false, blocker_reason: '',
  });

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Task title is required'); return; }
    setSaving(true);
    try {
      const { data: task, error } = await supabase.from('tasks').insert({
        title: form.title.trim(),
        description: form.description,
        task_status: form.task_status,
        priority: form.priority,
        category_id: form.category_id || null,
        assigned_to: form.assigned_to || null,
        creator_id: currentUserId,
        client_org_id: form.client_org_id || null,
        project_id: form.project_id || null,
        start_date: form.start_date || null,
        start_time: form.start_time || null,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        estimated_hours: parseFloat(form.estimated_hours) || 0,
        is_blocked: form.is_blocked,
        blocker_reason: form.blocker_reason || null,
        assigned_by: currentUserId,
        status: 'todo',
      }).select('id').single();

      if (error) throw error;

      // Add collaborators
      if (form.collaborators.length > 0 && task) {
        await supabase.from('task_collaborators').insert(
          form.collaborators.map(uid => ({ task_id: task.id, user_id: uid, added_by: currentUserId }))
        );
      }

      // Log activity
      if (task) {
        await supabase.from('task_activity').insert({
          task_id: task.id, user_id: currentUserId, action: 'created',
          new_value: form.title.trim(),
        });
      }

      toast.success('Task created successfully');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const toggleCollaborator = (uid: string) => {
    set('collaborators', form.collaborators.includes(uid)
      ? form.collaborators.filter(id => id !== uid)
      : [...form.collaborators, uid]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Create New Task</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Task Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter task title..." required />
          </div>
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Describe the task..." />
          </div>
          {/* Priority + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="critical">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
              <select value={form.task_status} onChange={e => set('task_status', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          {/* Category + Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
              <select value={form.category_id} onChange={e => set('category_id', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No Category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assignee</label>
              <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>
          {/* Client + Project */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Client / Organisation</label>
              <select value={form.client_org_id} onChange={e => set('client_org_id', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Internal (No Client)</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Project</label>
              <select value={form.project_id} onChange={e => set('project_id', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No Project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          {/* Times + Estimated Hours */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Start Time</label>
              <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Due Time</label>
              <input type="time" value={form.due_time} onChange={e => set('due_time', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Est. Hours</label>
              <input type="number" min="0" step="0.25" value={form.estimated_hours} onChange={e => set('estimated_hours', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00" />
            </div>
          </div>
          {/* Collaborators */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Collaborators</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {users.filter(u => u.id !== form.assigned_to).map(u => (
                <button key={u.id} type="button" onClick={() => toggleCollaborator(u.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    form.collaborators.includes(u.id)
                      ? 'bg-blue-600 text-white' :'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}>
                  {u.full_name}
                </button>
              ))}
            </div>
          </div>
          {/* Blocked */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="is_blocked" checked={form.is_blocked} onChange={e => set('is_blocked', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500" />
            <label htmlFor="is_blocked" className="text-sm font-medium text-slate-700 dark:text-slate-300">Mark as Blocked</label>
          </div>
          {form.is_blocked && (
            <input value={form.blocker_reason} onChange={e => set('blocker_reason', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Describe the blocker..." />
          )}
          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AllTasks() {
  const { effectiveUserId, pinSession } = useAuth();
  const supabase = createClient();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clients, setClients] = useState<ClientOrg[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [sortBy, setSortBy] = useState<'due_date' | 'priority' | 'created_at' | 'title'>('due_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const PAGE_SIZE = 25;

  const role = pinSession?.role || '';
  const isManager = role === 'director' || role === 'manager' || role === 'executive';

  const fetchAll = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const [usersRes, catsRes, clientsRes, projectsRes] = await Promise.all([
        supabase.from('user_profiles').select('id, full_name, role').eq('is_active', true).order('full_name'),
        supabase.from('task_categories').select('id, name, color').eq('is_active', true).order('name'),
        supabase.from('client_organisations').select('id, name').order('name'),
        supabase.from('projects').select('id, name').order('name'),
      ]);
      setUsers(usersRes.data || []);
      setCategories(catsRes.data || []);
      setClients(clientsRes.data || []);
      setProjects(projectsRes.data || []);

      // Fetch tasks
      let query = supabase.from('tasks').select(`
        id, title, description, task_status, priority, category_id, assigned_to,
        creator_id, client_org_id, organisation_id, project_id,
        start_date, start_time, due_date, due_time, estimated_hours, actual_hours,
        completion_percentage, is_recurring, is_blocked, is_overdue,
        completed_at, created_at, updated_at
      `).eq('is_recurring', false);

      if (!isManager) {
        query = query.or(`assigned_to.eq.${effectiveUserId},creator_id.eq.${effectiveUserId}`);
      }

      const { data: taskData, error } = await query.order('created_at', { ascending: false }).limit(500);
      if (error) throw error;

      // Fetch collaborators for tasks
      const taskIds = (taskData || []).map((t: any) => t.id);
      let collabMap: Record<string, { user_id: string; full_name: string }[]> = {};
      if (taskIds.length > 0) {
        const { data: collabs } = await supabase
          .from('task_collaborators')
          .select('task_id, user_id, user_profiles(full_name)')
          .in('task_id', taskIds.slice(0, 100));
        (collabs || []).forEach((c: any) => {
          if (!collabMap[c.task_id]) collabMap[c.task_id] = [];
          collabMap[c.task_id].push({ user_id: c.user_id, full_name: c.user_profiles?.full_name || '' });
        });
      }

      // Also include tasks where user is collaborator
      let extraTasks: any[] = [];
      if (!isManager) {
        const { data: myCollabs } = await supabase
          .from('task_collaborators')
          .select('task_id')
          .eq('user_id', effectiveUserId);
        const collabTaskIds = (myCollabs || []).map((c: any) => c.task_id);
        if (collabTaskIds.length > 0) {
          const existingIds = new Set((taskData || []).map((t: any) => t.id));
          const newIds = collabTaskIds.filter((id: string) => !existingIds.has(id));
          if (newIds.length > 0) {
            const { data: collabTasks } = await supabase
              .from('tasks')
              .select(`id, title, description, task_status, priority, category_id, assigned_to,
                creator_id, client_org_id, organisation_id, project_id,
                start_date, start_time, due_date, due_time, estimated_hours, actual_hours,
                completion_percentage, is_recurring, is_blocked, is_overdue,
                completed_at, created_at, updated_at`)
              .eq('is_recurring', false)
              .in('id', newIds.slice(0, 50));
            extraTasks = collabTasks || [];
          }
        }
      }

      const allTasks = [...(taskData || []), ...extraTasks];
      const userMap = Object.fromEntries((usersRes.data || []).map((u: any) => [u.id, u.full_name]));
      const catMap = Object.fromEntries((catsRes.data || []).map((c: any) => [c.id, c.name]));
      const clientMap = Object.fromEntries((clientsRes.data || []).map((c: any) => [c.id, c.name]));
      const projMap = Object.fromEntries((projectsRes.data || []).map((p: any) => [p.id, p.name]));

      const enriched: Task[] = allTasks.map((t: any) => ({
        ...t,
        task_status: t.task_status || 'not_started',
        assignee_name: t.assigned_to ? userMap[t.assigned_to] || '—' : '—',
        creator_name: t.creator_id ? userMap[t.creator_id] || '—' : '—',
        category_name: t.category_id ? catMap[t.category_id] || '—' : '—',
        client_org_name: t.client_org_id ? clientMap[t.client_org_id] || '—' : '—',
        project_name: t.project_id ? projMap[t.project_id] || '—' : '—',
        collaborators: collabMap[t.id] || [],
        is_overdue: isOverdue(t),
      }));

      setTasks(enriched);
    } catch (err: any) {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, isManager]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) &&
        !(t.assignee_name || '').toLowerCase().includes(search.toLowerCase()) &&
        !(t.client_org_name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== 'all' && t.task_status !== filterStatus) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterCategory !== 'all' && t.category_id !== filterCategory) return false;
    if (filterClient !== 'all' && t.client_org_id !== filterClient) return false;
    return true;
  }).sort((a, b) => {
    let av: any, bv: any;
    if (sortBy === 'due_date') { av = a.due_date || '9999'; bv = b.due_date || '9999'; }
    else if (sortBy === 'priority') {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      av = order[a.priority]; bv = order[b.priority];
    }
    else if (sortBy === 'title') { av = a.title; bv = b.title; }
    else { av = a.created_at; bv = b.created_at; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const toggleSelect = (id: string) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map(t => t.id)));
  };

  const handleBulkStatus = async (status: TaskStatus) => {
    if (selected.size === 0) return;
    try {
      await supabase.from('tasks').update({ task_status: status }).in('id', Array.from(selected));
      toast.success(`Updated ${selected.size} tasks`);
      setSelected(new Set());
      fetchAll();
    } catch { toast.error('Bulk update failed'); }
  };

  const exportCSV = () => {
    const headers = ['ID','Title','Status','Priority','Category','Assignee','Client','Project','Due Date','Est Hours','Actual Hours','Completion%','Recurring','Blocked','Created'];
    const rows = filtered.map(t => [
      t.id.slice(0,8), t.title, STATUS_CONFIG[t.task_status]?.label || t.task_status,
      PRIORITY_CONFIG[t.priority]?.label || t.priority, t.category_name || '—',
      t.assignee_name || '—', t.client_org_name || '—', t.project_name || '—',
      t.due_date || '—', String(t.estimated_hours || 0), String(t.actual_hours || 0),
      String(t.completion_percentage || 0), t.is_recurring ? 'Yes' : 'No',
      t.is_blocked ? 'Yes' : 'No', fmt(t.created_at),
    ]);
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Tasks_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => (
    <ArrowUpDown size={12} className={`ml-1 inline ${sortBy === col ? 'text-blue-500' : 'text-slate-300'}`} />
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Toaster position="top-right" richColors />
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchAll}
          users={users}
          categories={categories}
          clients={clients}
          projects={projects}
          currentUserId={effectiveUserId || ''}
          isManager={isManager}
        />
      )}

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="Go back">
              <ArrowLeft size={16} />
            </button>
            <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">All Tasks</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {filtered.length} task{filtered.length !== 1 ? 's' : ''} {search || filterStatus !== 'all' ? '(filtered)' : ''}
            </p>
          </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <Download size={14} /> Export
            </button>
            <button onClick={fetchAll} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
              <Plus size={14} /> New Task
            </button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search tasks..." />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${showFilters ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            <SlidersHorizontal size={14} /> Filters
            {(filterStatus !== 'all' || filterPriority !== 'all' || filterCategory !== 'all' || filterClient !== 'all') && (
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">All Priorities</option>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterClient} onChange={e => { setFilterClient(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">All Clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => { setFilterStatus('all'); setFilterPriority('all'); setFilterCategory('all'); setFilterClient('all'); setSearch(''); }}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-6 py-2 flex items-center gap-3">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            {(['in_progress', 'completed', 'cancelled'] as TaskStatus[]).map(s => (
              <button key={s} onClick={() => handleBulkStatus(s)}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                Mark {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-500 hover:text-blue-700 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-blue-500" />
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <CheckSquare size={40} className="mb-3 opacity-30" />
            <p className="text-base font-medium">No tasks found</p>
            <p className="text-sm mt-1">
              {search || filterStatus !== 'all' ? 'Try adjusting your filters' : 'Create your first task to get started'}
            </p>
            {!search && filterStatus === 'all' && (
              <button onClick={() => setShowCreate(true)} className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                <Plus size={14} className="inline mr-1" /> New Task
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="w-10 px-4 py-3 text-left">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    {selected.size === paginated.length && paginated.length > 0 ? <CheckSquare size={16} className="text-blue-500" /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 cursor-pointer whitespace-nowrap" onClick={() => toggleSort('title')}>
                  Task <SortIcon col="title" />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 cursor-pointer whitespace-nowrap" onClick={() => toggleSort('priority')}>
                  Priority <SortIcon col="priority" />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Category</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Assignee</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Client</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 cursor-pointer whitespace-nowrap" onClick={() => toggleSort('due_date')}>
                  Due Date <SortIcon col="due_date" />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Est h</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">%</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginated.map(task => {
                const sc = STATUS_CONFIG[task.task_status] || STATUS_CONFIG.not_started;
                const pc = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                const overdue = isOverdue(task);
                return (
                  <tr key={task.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selected.has(task.id) ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(task.id)} className="text-slate-400 hover:text-blue-500 transition-colors">
                        {selected.has(task.id) ? <CheckSquare size={16} className="text-blue-500" /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{task.title}</div>
                      {task.project_name && task.project_name !== '—' && (
                        <div className="text-xs text-slate-400 truncate mt-0.5">{task.project_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                        {pc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                      {task.category_name && task.category_name !== '—' ? task.category_name : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 text-xs whitespace-nowrap">
                      {task.assignee_name && task.assignee_name !== '—' ? task.assignee_name : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                      {task.client_org_name && task.client_org_name !== '—' ? task.client_org_name : <span className="text-slate-300">Internal</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
                        {fmt(task.due_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {task.estimated_hours > 0 ? `${task.estimated_hours}h` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.completion_percentage || 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{task.completion_percentage || 0}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {overdue && <AlertTriangle size={12} className="text-red-500" title="Overdue" />}
                        {task.is_blocked && <Flag size={12} className="text-red-500" title="Blocked" />}
                        {task.is_recurring && <Repeat size={12} className="text-purple-500" title="Recurring" />}
                        {(task.collaborators || []).length > 0 && (
                          <span className="text-xs text-slate-400" title={`${task.collaborators?.length} collaborator(s)`}>
                            <Users size={12} className="text-blue-400" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <span className="text-sm text-slate-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Previous
            </button>
            <span className="text-sm text-slate-600 dark:text-slate-400">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, RefreshCw, Calendar, CheckCircle2, Clock, AlertTriangle, BarChart3, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast, Toaster } from 'sonner';



type ReportType = 'attendance' | 'tasks' | 'performance' | 'leave' | 'expenses' | 'discrepancies';

interface UserProfile { id: string; full_name: string; department: string; role: string; }

function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; }
}
function fmtDT(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return d; }
}
function fmtMins(m: number | null | undefined) {
  if (!m) return '—';
  const h = Math.floor(m / 60), min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

// Compute effective status for a task row
function effectiveStatus(r: any, today: string): 'completed' | 'overdue' | 'pending' | 'in_progress' | 'cancelled' {
  if (r.status === 'done' || r.status === 'completed') return 'completed';
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'overdue') return 'overdue';
  if (r.due_date && r.due_date < today && r.status !== 'done') return 'overdue';
  if (r.status === 'in-progress' || r.status === 'in_progress') return 'in_progress';
  return 'pending';
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const REPORT_TYPES: { id: ReportType; label: string; icon: React.ElementType; color: string; bg: string }[] = [
  { id: 'attendance', label: 'Attendance', icon: Clock, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  { id: 'performance', label: 'Performance', icon: BarChart3, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  { id: 'leave', label: 'Leave', icon: Calendar, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  { id: 'expenses', label: 'Expenses', icon: FileText, color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
  { id: 'discrepancies', label: 'Client Discrepancies', icon: AlertTriangle, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
];

// Group tasks by date for the detailed recurring view
interface TaskDateGroup {
  date: string;
  tasks: any[];
  completedCount: number;
  overdueCount: number;
  pendingCount: number;
}

export default function ReportsPage() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();

  const [activeReport, setActiveReport] = useState<ReportType>('attendance');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  // Working hours config for late detection
  const [workingHoursConfig, setWorkingHoursConfig] = useState<{ standard_start: string; standard_end: string; daily_hours: number }>({
    standard_start: '09:00',
    standard_end: '18:00',
    daily_hours: 8,
  });

  // Filters
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [userFilter, setUserFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState<'all' | 'recurring' | 'one_time'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('user_profiles').select('id, full_name, department, role').order('full_name').then(({ data }) => {
      if (data) {
        setUsers(data);
        const depts = Array.from(new Set(data.map((u: any) => u.department).filter(Boolean))).sort() as string[];
        setDepartments(depts);
      }
    });
    // Load working hours config from director_settings key-value store
    supabase.from('director_settings')
      .select('setting_key, setting_value')
      .eq('setting_key', 'working_hours')
      .single()
      .then(({ data: wh }) => {
        if (wh?.setting_value) {
          setWorkingHoursConfig({
            standard_start: wh.setting_value.standard_start || '09:00',
            standard_end: wh.setting_value.standard_end || '18:00',
            daily_hours: wh.setting_value.daily_hours || 8,
          });
        }
      });
  }, [effectiveUserId]);

  const fetchReport = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      let result: any[] = [];
      if (activeReport === 'attendance') {
        let q = supabase.from('attendance_records')
          .select('*, user_profiles!attendance_records_user_id_fkey(full_name, department)')
          .gte('work_date', dateFrom).lte('work_date', dateTo)
          .order('work_date', { ascending: false });
        if (userFilter !== 'all') q = q.eq('user_id', userFilter);
        const { data: d } = await q;
        result = (d || []).filter((r: any) => {
          if (deptFilter !== 'all' && r.user_profiles?.department !== deptFilter) return false;
          if (statusFilter !== 'all' && r.status !== statusFilter) return false;
          if (searchQuery && !r.user_profiles?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        }).map((r: any) => {
          // Derive check-in/out display times from clock_in/clock_out timestamps
          const checkInTime = r.clock_in
            ? new Date(r.clock_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
            : null;
          const checkOutTime = r.clock_out
            ? new Date(r.clock_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
            : null;

          // Hours present: use total_hours from DB, or compute from clock_in/clock_out
          let hoursPresent: number | null = r.total_hours || null;
          if (!hoursPresent && r.clock_in && r.clock_out) {
            const diffMs = new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime();
            const breakMs = (r.break_minutes || 0) * 60 * 1000;
            hoursPresent = Math.max(0, (diffMs - breakMs) / (1000 * 60 * 60));
          }

          // Late status: use late_arrival_minutes if present, else compare clock_in to standard_start
          let isLate = false;
          let lateMinutes = r.late_arrival_minutes || 0;
          if (!lateMinutes && r.clock_in && workingHoursConfig.standard_start) {
            const clockInDate = new Date(r.clock_in);
            const [stdHour, stdMin] = workingHoursConfig.standard_start.split(':').map(Number);
            const stdStartMs = new Date(clockInDate).setHours(stdHour, stdMin, 0, 0);
            const diffMins = Math.floor((clockInDate.getTime() - stdStartMs) / 60000);
            if (diffMins > 5) { // 5-minute grace period
              lateMinutes = diffMins;
            }
          }
          isLate = lateMinutes > 0 || r.status === 'late';

          return {
            ...r,
            checkInTime,
            checkOutTime,
            hoursPresent: hoursPresent ? parseFloat(hoursPresent.toFixed(2)) : null,
            isLate,
            lateMinutes,
          };
        });
      } else if (activeReport === 'tasks') {
        // Fetch ALL tasks — no date filter at DB level so we capture every instance
        let q = supabase.from('tasks')
          .select('id, title, status, priority, due_date, due_time, assigned_to_name, assigned_to_dept, assigned_to_user_id, created_at, completed_at, time_to_complete_minutes, recurring, task_category, instance_date, parent_recurring_task_id')
          .order('due_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (userFilter !== 'all') q = q.eq('assigned_to_user_id', userFilter);
        const { data: d } = await q;
        const today = new Date().toISOString().split('T')[0];
        result = (d || []).filter((r: any) => {
          // Use instance_date if available (recurring instances), else due_date, else created_at date
          const taskDate = r.instance_date || r.due_date || r.created_at?.split('T')[0];
          if (dateFrom && taskDate < dateFrom) return false;
          if (dateTo && taskDate > dateTo) return false;
          if (deptFilter !== 'all' && r.assigned_to_dept !== deptFilter) return false;
          // Status filter
          if (statusFilter !== 'all') {
            const es = effectiveStatus(r, today);
            if (statusFilter === 'completed' && es !== 'completed') return false;
            if (statusFilter === 'overdue' && es !== 'overdue') return false;
            if (statusFilter === 'pending' && es !== 'pending') return false;
            if (statusFilter === 'in_progress' && es !== 'in_progress') return false;
          }
          // Task type filter
          if (taskTypeFilter === 'recurring' && !r.recurring && !r.parent_recurring_task_id) return false;
          if (taskTypeFilter === 'one_time' && (r.recurring || r.parent_recurring_task_id)) return false;
          if (searchQuery && !r.title?.toLowerCase().includes(searchQuery.toLowerCase()) && !r.assigned_to_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        });
      } else if (activeReport === 'performance') {
        const [tasksRes, attRes] = await Promise.all([
          supabase.from('tasks').select('assigned_to_user_id, assigned_to_name, assigned_to_dept, status, due_date, completed_at, time_to_complete_minutes'),
          supabase.from('attendance_records').select('user_id, status, check_in_time').gte('work_date', dateFrom).lte('work_date', dateTo),
        ]);
        const today = new Date().toISOString().split('T')[0];
        const filteredUsers = users.filter(u => {
          if (deptFilter !== 'all' && u.department !== deptFilter) return false;
          if (userFilter !== 'all' && u.id !== userFilter) return false;
          if (searchQuery && !u.full_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        });
        result = filteredUsers.map(u => {
          const uTasks = (tasksRes.data || []).filter((t: any) => t.assigned_to_user_id === u.id);
          const uAtt = (attRes.data || []).filter((a: any) => a.user_id === u.id);
          const done = uTasks.filter((t: any) => t.status === 'done' || t.status === 'completed').length;
          const overdue = uTasks.filter((t: any) => t.status === 'overdue' || (t.due_date && t.due_date < today && t.status !== 'done')).length;
          const present = uAtt.filter((a: any) => ['present', 'late', 'half_day', 'work_from_home'].includes(a.status)).length;
          const late = uAtt.filter((a: any) => a.status === 'late').length;
          const totalAtt = uAtt.length;
          const avgMins = (() => {
            const c = uTasks.filter((t: any) => t.time_to_complete_minutes > 0);
            return c.length > 0 ? Math.round(c.reduce((s: number, t: any) => s + t.time_to_complete_minutes, 0) / c.length) : null;
          })();
          return {
            id: u.id, name: u.full_name, department: u.department,
            totalTasks: uTasks.length, completed: done, pending: uTasks.length - done - overdue, overdue,
            completionPct: uTasks.length > 0 ? Math.round((done / uTasks.length) * 100) : 0,
            attendancePct: totalAtt > 0 ? Math.round((present / totalAtt) * 100) : 0,
            lateCount: late, avgCompletionTime: avgMins,
          };
        }).filter(u => u.totalTasks > 0 || u.attendancePct > 0);
      } else if (activeReport === 'leave') {
        let q = supabase.from('leave_requests')
          .select('*, user_profiles(full_name, department)')
          .gte('start_date', dateFrom).lte('end_date', dateTo)
          .order('created_at', { ascending: false });
        if (userFilter !== 'all') q = q.eq('user_id', userFilter);
        const { data: d } = await q;
        result = (d || []).filter((r: any) => {
          if (deptFilter !== 'all' && r.user_profiles?.department !== deptFilter) return false;
          if (statusFilter !== 'all' && r.status !== statusFilter) return false;
          if (searchQuery && !r.user_profiles?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        });
      } else if (activeReport === 'expenses') {
        let q = supabase.from('expenses')
          .select('*, user_profiles(full_name, department)')
          .gte('expense_date', dateFrom).lte('expense_date', dateTo)
          .order('created_at', { ascending: false });
        if (userFilter !== 'all') q = q.eq('user_id', userFilter);
        const { data: d } = await q;
        result = (d || []).filter((r: any) => {
          if (deptFilter !== 'all' && r.user_profiles?.department !== deptFilter) return false;
          if (statusFilter !== 'all' && r.status !== statusFilter) return false;
          if (searchQuery && !r.title?.toLowerCase().includes(searchQuery.toLowerCase()) && !r.user_profiles?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        });
      } else if (activeReport === 'discrepancies') {
        let q = supabase.from('client_discrepancy_reports')
          .select('*, reporter:reported_by(full_name, department)')
          .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')
          .order('created_at', { ascending: false });
        const { data: d } = await q;
        result = (d || []).filter((r: any) => {
          if (statusFilter !== 'all' && r.status !== statusFilter) return false;
          if (searchQuery && !r.title?.toLowerCase().includes(searchQuery.toLowerCase()) && !r.client_name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
          return true;
        });
      }
      setData(result);
      setExpandedDates(new Set()); // reset expanded state on new fetch
    } catch (err: any) {
      toast.error('Failed to load report: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [activeReport, dateFrom, dateTo, userFilter, deptFilter, statusFilter, taskTypeFilter, searchQuery, effectiveUserId, users]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // Group tasks by date for the detailed view
  const groupTasksByDate = (tasks: any[]): TaskDateGroup[] => {
    const today = new Date().toISOString().split('T')[0];
    const map = new Map<string, any[]>();
    tasks.forEach(t => {
      const d = t.instance_date || t.due_date || t.created_at?.split('T')[0] || 'unknown';
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(t);
    });
    // Sort dates descending
    const sorted = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    return sorted.map(([date, tasks]) => ({
      date,
      tasks,
      completedCount: tasks.filter(t => effectiveStatus(t, today) === 'completed').length,
      overdueCount: tasks.filter(t => effectiveStatus(t, today) === 'overdue').length,
      pendingCount: tasks.filter(t => ['pending', 'in_progress'].includes(effectiveStatus(t, today))).length,
    }));
  };

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const handleExportCSV = () => {
    if (data.length === 0) { toast.error('No data to export'); return; }
    let headers: string[] = [];
    let rows: any[][] = [];

    if (activeReport === 'attendance') {
      headers = ['Date', 'Employee', 'Department', 'Check-In', 'Check-Out', 'Hours Present', 'Status', 'Late', 'Late By (mins)', 'Early Departure (mins)'];
      rows = data.map(r => [
        fmt(r.work_date),
        r.user_profiles?.full_name || '—',
        r.user_profiles?.department || '—',
        r.checkInTime || '—',
        r.checkOutTime || '—',
        r.hoursPresent != null ? `${r.hoursPresent}h` : '—',
        r.status || '—',
        r.isLate ? 'Yes' : 'No',
        r.lateMinutes || 0,
        r.early_departure_minutes || 0,
      ]);
    } else if (activeReport === 'tasks') {
      const today = new Date().toISOString().split('T')[0];
      headers = ['Date', 'Task Name', 'Type', 'Assigned To', 'Department', 'Date Assigned', 'Due Date', 'Due Time', 'Completed At', 'Time Taken', 'Status', 'Overdue', 'Priority', 'Category'];
      rows = data.map(r => {
        const taskDate = r.instance_date || r.due_date || r.created_at?.split('T')[0];
        const es = effectiveStatus(r, today);
        return [
          fmt(taskDate),
          r.title,
          r.recurring || r.parent_recurring_task_id ? 'Recurring' : 'One-Time',
          r.assigned_to_name || '—',
          r.assigned_to_dept || '—',
          fmtDT(r.created_at),
          r.due_date ? fmt(r.due_date) : '—',
          r.due_time || '—',
          fmtDT(r.completed_at),
          fmtMins(r.time_to_complete_minutes),
          es,
          es === 'overdue' ? 'Yes' : 'No',
          r.priority || '—',
          r.task_category || '—',
        ];
      });
    } else if (activeReport === 'performance') {
      headers = ['Employee', 'Department', 'Total Tasks', 'Completed', 'Pending', 'Overdue', 'Completion %', 'Attendance %', 'Late Count', 'Avg Completion Time'];
      rows = data.map(r => [
        r.name, r.department, r.totalTasks, r.completed, r.pending, r.overdue,
        `${r.completionPct}%`, `${r.attendancePct}%`, r.lateCount, fmtMins(r.avgCompletionTime),
      ]);
    } else if (activeReport === 'leave') {
      headers = ['Employee', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Status', 'Reason'];
      rows = data.map(r => [
        r.user_profiles?.full_name || '—', r.user_profiles?.department || '—',
        r.leave_type, fmt(r.start_date), fmt(r.end_date), r.total_days,
        r.status, r.reason || '—',
      ]);
    } else if (activeReport === 'expenses') {
      headers = ['Employee', 'Department', 'Title', 'Category', 'Amount (₹)', 'Date', 'Status', 'Receipt'];
      rows = data.map(r => [
        r.user_profiles?.full_name || '—', r.user_profiles?.department || '—',
        r.title, r.category, r.amount, fmt(r.expense_date), r.status,
        r.receipt_url ? 'Yes' : 'No',
      ]);
    } else if (activeReport === 'discrepancies') {
      headers = ['Title', 'Client', 'Type', 'Severity', 'Status', 'Reported By', 'Date', 'Resolution Notes'];
      rows = data.map(r => [
        r.title, r.client_name, r.discrepancy_type, r.severity, r.status,
        (r.reporter as any)?.full_name || '—', fmtDT(r.created_at), r.resolution_notes || '—',
      ]);
    }

    downloadCSV(`${activeReport}-report-${dateFrom}-to-${dateTo}.csv`, headers, rows);
    toast.success('CSV exported successfully');
  };

  const renderTasksReport = () => {
    const today = new Date().toISOString().split('T')[0];
    const groups = groupTasksByDate(data);

    if (groups.length === 0) return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <FileText size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-semibold">No task records found for selected filters</p>
      </div>
    );

    // Summary bar
    const totalCompleted = data.filter(t => effectiveStatus(t, today) === 'completed').length;
    const totalOverdue = data.filter(t => effectiveStatus(t, today) === 'overdue').length;
    const totalPending = data.filter(t => ['pending', 'in_progress'].includes(effectiveStatus(t, today))).length;
    const completionRate = data.length > 0 ? Math.round((totalCompleted / data.length) * 100) : 0;

    return (
      <div>
        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-slate-700/30 border-b border-slate-100 dark:border-slate-700">
          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Total Tasks</p>
            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{data.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Completed</p>
            <p className="text-xl font-bold text-emerald-600">{totalCompleted}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Overdue</p>
            <p className="text-xl font-bold text-red-600">{totalOverdue}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Completion Rate</p>
            <p className={`text-xl font-bold ${completionRate >= 80 ? 'text-emerald-600' : completionRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{completionRate}%</p>
          </div>
        </div>

        {/* Date-grouped task list */}
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {groups.map(group => {
            const isExpanded = expandedDates.has(group.date);
            return (
              <div key={group.date}>
                {/* Date header row — clickable to expand/collapse */}
                <button
                  onClick={() => toggleDate(group.date)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors text-left"
                >
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">{fmt(group.date)}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {group.completedCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          ✓ {group.completedCount} done
                        </span>
                      )}
                      {group.overdueCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                          ⚠ {group.overdueCount} overdue
                        </span>
                      )}
                      {group.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                          ○ {group.pendingCount} pending
                        </span>
                      )}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
                </button>

                {/* Expanded task rows */}
                {isExpanded && (
                  <div className="overflow-x-auto bg-white dark:bg-slate-800/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-700/60">
                          {['Task Name', 'Type', 'Assigned To', 'Dept', 'Assigned At', 'Due Date', 'Due Time', 'Completed At', 'Time Taken', 'Status', 'Overdue', 'Priority'].map(h => (
                            <th key={h} className="text-left px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {group.tasks.map((r, i) => {
                          const es = effectiveStatus(r, today);
                          const isRecurring = r.recurring || !!r.parent_recurring_task_id;
                          return (
                            <tr key={r.id || i} className={`hover:bg-slate-50 dark:hover:bg-slate-700/20 ${es === 'overdue' ? 'bg-red-50/30 dark:bg-red-900/10' : es === 'completed' ? 'bg-emerald-50/20 dark:bg-emerald-900/10' : ''}`}>
                              <td className="px-3 py-2.5 max-w-[180px]">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{r.title}</div>
                                {r.task_category && <div className="text-[10px] text-slate-400 truncate">{r.task_category}</div>}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isRecurring ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {isRecurring ? '↻ Recurring' : '● One-Time'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap font-medium">{r.assigned_to_name || '—'}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.assigned_to_dept || '—'}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDT(r.created_at)}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.due_date ? fmt(r.due_date) : '—'}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.due_time || '—'}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDT(r.completed_at)}</td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtMins(r.time_to_complete_minutes)}</td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${STATUS_COLORS[es] || 'bg-slate-100 text-slate-600'}`}>
                                  {es.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className={`font-bold text-xs ${es === 'overdue' ? 'text-red-600' : 'text-emerald-600'}`}>
                                  {es === 'overdue' ? '⚠ Yes' : '✓ No'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${r.priority === 'high' || r.priority === 'urgent' ? 'bg-red-100 text-red-700' : r.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {r.priority || 'normal'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTable = () => {
    if (loading) return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
    if (data.length === 0) return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <FileText size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-semibold">No records found for selected filters</p>
      </div>
    );

    if (activeReport === 'tasks') return renderTasksReport();

    if (activeReport === 'attendance') {
      return (
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
            {['Date', 'Employee', 'Department', 'Check-In', 'Check-Out', 'Hours Present', 'Status', 'Late', 'Late By'].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.map((r, i) => (
              <tr key={i} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 ${r.isLate ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">{fmt(r.work_date)}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.user_profiles?.full_name || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.user_profiles?.department || '—'}</td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono">
                  {r.checkInTime || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono">
                  {r.checkOutTime || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.hoursPresent != null ? (
                    <span className={`font-semibold ${r.hoursPresent >= (workingHoursConfig.daily_hours * 0.9) ? 'text-emerald-600' : r.hoursPresent >= (workingHoursConfig.daily_hours * 0.5) ? 'text-amber-600' : 'text-red-600'}`}>
                      {r.hoursPresent}h
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.status === 'present' ? 'bg-emerald-100 text-emerald-700' : r.status === 'absent' ? 'bg-red-100 text-red-700' : r.status === 'late' ? 'bg-amber-100 text-amber-700' : r.status === 'work_from_home' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                    {r.status?.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.isLate ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">⚠ Late</span>
                  ) : (
                    <span className="text-emerald-600 text-[10px] font-semibold">✓ On Time</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                  {r.lateMinutes > 0 ? `${r.lateMinutes}m` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeReport === 'performance') {
      return (
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
            {['Employee', 'Department', 'Total Tasks', 'Completed', 'Pending', 'Overdue', 'Completion %', 'Attendance %', 'Late Count', 'Avg Time'].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.department || '—'}</td>
                <td className="px-3 py-2.5 font-bold text-slate-700">{r.totalTasks}</td>
                <td className="px-3 py-2.5 text-emerald-600 font-semibold">{r.completed}</td>
                <td className="px-3 py-2.5 text-amber-600 font-semibold">{r.pending}</td>
                <td className="px-3 py-2.5 text-red-600 font-semibold">{r.overdue}</td>
                <td className="px-3 py-2.5"><span className={`font-bold ${r.completionPct >= 80 ? 'text-emerald-600' : r.completionPct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{r.completionPct}%</span></td>
                <td className="px-3 py-2.5"><span className={`font-bold ${r.attendancePct >= 90 ? 'text-emerald-600' : r.attendancePct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{r.attendancePct}%</span></td>
                <td className="px-3 py-2.5 text-slate-500">{r.lateCount}</td>
                <td className="px-3 py-2.5 text-slate-500">{fmtMins(r.avgCompletionTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeReport === 'leave') {
      return (
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
            {['Employee', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Status', 'Reason'].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.user_profiles?.full_name || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.user_profiles?.department || '—'}</td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap capitalize">{r.leave_type?.replace('_', ' ')}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmt(r.start_date)}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmt(r.end_date)}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-700">{r.total_days}</td>
                <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span></td>
                <td className="px-3 py-2.5 max-w-[160px] truncate text-slate-500">{r.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeReport === 'expenses') {
      return (
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
            {['Employee', 'Department', 'Title', 'Category', 'Amount', 'Date', 'Status', 'Receipt'].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{r.user_profiles?.full_name || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.user_profiles?.department || '—'}</td>
                <td className="px-3 py-2.5 max-w-[140px] truncate text-slate-700 dark:text-slate-300">{r.title}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.category}</td>
                <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">₹{r.amount?.toLocaleString('en-IN')}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmt(r.expense_date)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.status === 'approved' || r.status === 'reimbursed' ? 'bg-emerald-100 text-emerald-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span></td>
                <td className="px-3 py-2.5 text-slate-500">{r.receipt_url ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeReport === 'discrepancies') {
      return (
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
            {['Title', 'Client', 'Type', 'Severity', 'Status', 'Reported By', 'Date'].map(h => (
              <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="px-3 py-2.5 max-w-[160px] truncate font-medium text-slate-900 dark:text-slate-100">{r.title}</td>
                <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.client_name}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{r.discrepancy_type}</td>
                <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.severity === 'critical' ? 'bg-red-100 text-red-700' : r.severity === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{r.severity}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${r.status === 'resolved' || r.status === 'closed' ? 'bg-emerald-100 text-emerald-700' : r.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span></td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{(r.reporter as any)?.full_name || '—'}</td>
                <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDT(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    return null;
  };

  const activeType = REPORT_TYPES.find(t => t.id === activeReport)!;

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <FileText size={16} className="text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Reports</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Export attendance, tasks, performance, leave, expenses and discrepancy reports</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchReport} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Report Type Selector */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {REPORT_TYPES.map(rt => {
          const RtIcon = rt.icon;
          return (
            <button key={rt.id} onClick={() => setActiveReport(rt.id)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${activeReport === rt.id ? rt.bg + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}>
              <RtIcon size={18} className={activeReport === rt.id ? rt.color : 'text-slate-400'} />
              <span className={`text-xs font-semibold ${activeReport === rt.id ? rt.color : 'text-slate-600 dark:text-slate-400'}`}>{rt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 mb-5 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Employee</label>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Employees</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Department</label>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Status</option>
              {activeReport === 'attendance' && <>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
                <option value="leave">Leave</option>
              </>}
              {activeReport === 'tasks' && <>
                <option value="completed">Completed</option>
                <option value="in_progress">In Progress</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
              </>}
              {activeReport === 'leave' && <>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </>}
              {activeReport === 'expenses' && <>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="reimbursed">Reimbursed</option>
              </>}
              {activeReport === 'discrepancies' && <>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </>}
            </select>
          </div>
        </div>
        {/* Task-specific extra filters */}
        {activeReport === 'tasks' && (
          <div className="mt-3 flex flex-wrap gap-3 items-center">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Task Type</label>
              <select value={taskTypeFilter} onChange={e => setTaskTypeFilter(e.target.value as any)}
                className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                <option value="all">All Types</option>
                <option value="recurring">Recurring Only</option>
                <option value="one_time">One-Time Only</option>
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search task or employee…"
                  className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
              </div>
            </div>
            <div className="self-end">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Click a date row to expand all tasks for that day</p>
            </div>
          </div>
        )}
        {activeReport !== 'tasks' && (
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search…"
              className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <activeType.icon size={16} className={activeType.color} />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {activeType.label} Report — {activeReport === 'tasks' ? `${data.length} task instances` : `${data.length} records`}
            </h3>
          </div>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
            <Download size={13} /> Export CSV
          </button>
        </div>
        <div className={activeReport === 'tasks' ? '' : 'overflow-x-auto'}>
          {renderTable()}
        </div>
      </div>
    </div>
  );
}

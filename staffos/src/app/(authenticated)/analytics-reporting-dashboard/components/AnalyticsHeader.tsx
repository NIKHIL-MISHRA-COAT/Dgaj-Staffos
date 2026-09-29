'use client';

import React, { useState } from 'react';
import { BarChart3, Download, Filter, RefreshCw, ChevronDown, FileSpreadsheet, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';



const dateRanges = ['Last 7 days', 'Last 30 days', 'This Quarter', 'Last Quarter', 'This Year', 'Custom Range'];
const departments = ['All Departments', 'Engineering', 'Product', 'HR & Operations', 'Sales', 'Finance', 'Marketing'];

function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) { toast.error('No data to export'); return; }
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h] ?? '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    }).join(','))
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${data.length} records to ${filename}`);
}

export default function AnalyticsHeader() {
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [department, setDepartment] = useState('All Departments');
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [showDeptMenu, setShowDeptMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { t } = useLanguage();
  const supabase = createClient();

  const getDateRange = () => {
    const now = new Date();
    let start: string;
    const end = now.toISOString().split('T')[0];
    if (dateRange === 'Last 7 days') start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
    else if (dateRange === 'Last 30 days') start = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    else if (dateRange === 'This Quarter') {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1).toISOString().split('T')[0];
    } else if (dateRange === 'Last Quarter') {
      const q = Math.floor(now.getMonth() / 3);
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
      start = new Date(ly, lq * 3, 1).toISOString().split('T')[0];
    } else if (dateRange === 'This Year') {
      start = `${now.getFullYear()}-01-01`;
    } else {
      start = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
    }
    return { start, end };
  };

  const exportAttendance = async () => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const { start, end } = getDateRange();
      let query = supabase
        .from('attendance_records')
        .select('*, user_profiles(full_name, department, job_title)')
        .gte('work_date', start)
        .lte('work_date', end)
        .order('work_date', { ascending: false });
      if (department !== 'All Departments') {
        // Filter via join — fetch all and filter client-side
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        Date: r.work_date,
        Employee: r.user_profiles?.full_name || r.user_id,
        Department: r.user_profiles?.department || '',
        'Job Title': r.user_profiles?.job_title || '',
        Status: r.status,
        'Clock In': r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-IN') : '',
        'Clock Out': r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-IN') : '',
        'Total Hours': r.total_hours || 0,
        'Overtime Hours': r.overtime_hours || 0,
        Notes: r.notes || '',
      }));
      downloadCSV(rows, `attendance_${start}_to_${end}.csv`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const exportTasks = async () => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const { start, end } = getDateRange();
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end + 'T23:59:59')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((t: any) => ({
        Title: t.title,
        Status: t.status,
        Priority: t.priority,
        Category: t.task_category || '',
        'Assigned To': t.assigned_to_name || '',
        Department: t.assigned_to_dept || '',
        'Due Date': t.due_date || '',
        Recurring: t.recurring || 'one-time',
        'Created At': t.created_at?.split('T')[0] || '',
        'Is Overdue': t.is_overdue ? 'Yes' : 'No',
      }));
      downloadCSV(rows, `tasks_${start}_to_${end}.csv`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const exportExpenses = async () => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const { start, end } = getDateRange();
      const { data, error } = await supabase
        .from('expenses')
        .select('*, user_profiles(full_name, department)')
        .gte('expense_date', start)
        .lte('expense_date', end)
        .order('expense_date', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((e: any) => ({
        Title: e.title,
        Employee: e.user_profiles?.full_name || '',
        Department: e.user_profiles?.department || '',
        Category: e.category || '',
        Amount: e.amount || 0,
        Currency: e.currency || 'INR',
        Date: e.expense_date || '',
        Status: e.status || '',
        Description: e.description || '',
      }));
      downloadCSV(rows, `expenses_${start}_to_${end}.csv`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const exportLeaves = async () => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const { start, end } = getDateRange();
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*, user_profiles(full_name, department)')
        .gte('start_date', start)
        .lte('start_date', end)
        .order('start_date', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((l: any) => ({
        Employee: l.user_profiles?.full_name || '',
        Department: l.user_profiles?.department || '',
        'Leave Type': l.leave_type || '',
        'Start Date': l.start_date || '',
        'End Date': l.end_date || '',
        Status: l.status || '',
        Reason: l.reason || '',
      }));
      downloadCSV(rows, `leaves_${start}_to_${end}.csv`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async () => {
    setExporting(true);
    setShowExportMenu(false);
    toast.info('Exporting all data — this may take a moment…');
    await exportAttendance();
    await exportTasks();
    await exportExpenses();
    await exportLeaves();
    setExporting(false);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <BarChart3 size={20} className="text-blue-600" />
          <h1 className="text-2xl font-700 text-slate-900 dark:text-slate-100">{t('analyticsTitle')}</h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('companyWideVisibility')} · {t('lastUpdated')} <span className="font-600 text-slate-700 dark:text-slate-300">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </p>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Date Range */}
        <div className="relative">
          <button
            onClick={() => { setShowDateMenu(!showDateMenu); setShowDeptMenu(false); setShowExportMenu(false); }}
            className="btn-secondary text-xs gap-1.5"
          >
            <Filter size={13} />
            {dateRange}
            <ChevronDown size={13} />
          </button>
          {showDateMenu && (
            <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal py-1 z-20 min-w-[180px]">
              {dateRanges?.map((r) => (
                <button
                  key={`range-${r}`}
                  onClick={() => { setDateRange(r); setShowDateMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${dateRange === r ? 'text-blue-600 font-600' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Department */}
        <div className="relative">
          <button
            onClick={() => { setShowDeptMenu(!showDeptMenu); setShowDateMenu(false); setShowExportMenu(false); }}
            className="btn-secondary text-xs gap-1.5"
          >
            {department}
            <ChevronDown size={13} />
          </button>
          {showDeptMenu && (
            <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal py-1 z-20 min-w-[200px]">
              {departments?.map((d) => (
                <button
                  key={`dept-${d}`}
                  onClick={() => { setDepartment(d); setShowDeptMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${department === d ? 'text-blue-600 font-600' : 'text-slate-700 dark:text-slate-300'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => window.location.reload()} className="btn-ghost text-xs gap-1.5 border border-slate-200 dark:border-slate-700">
          <RefreshCw size={13} />
          {t('refresh')}
        </button>

        {/* Export Dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowExportMenu(!showExportMenu); setShowDateMenu(false); setShowDeptMenu(false); }}
            disabled={exporting}
            className="btn-primary text-xs gap-1.5 disabled:opacity-60"
          >
            <Download size={13} />
            {exporting ? 'Exporting…' : t('exportReport')}
            <ChevronDown size={13} />
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal py-1 z-20 min-w-[220px]">
              <div className="px-3 py-1.5 text-[10px] font-700 text-slate-400 uppercase tracking-wider">Export as CSV</div>
              {[
                { label: 'Attendance Records', icon: FileSpreadsheet, action: exportAttendance },
                { label: 'Task Report', icon: FileSpreadsheet, action: exportTasks },
                { label: 'Expense Report', icon: FileSpreadsheet, action: exportExpenses },
                { label: 'Leave Report', icon: FileSpreadsheet, action: exportLeaves },
                { label: 'Export All Data', icon: FileText, action: exportAll },
              ].map(({ label, icon: Icon, action }) => (
                <button key={label} onClick={action}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300">
                  <Icon size={14} className="text-slate-400" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
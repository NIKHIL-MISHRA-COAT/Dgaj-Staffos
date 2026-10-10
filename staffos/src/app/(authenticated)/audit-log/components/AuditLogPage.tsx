'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Download, RefreshCw, User, Eye, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast, Toaster } from 'sonner';

interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  module: string | null;
  created_at: string;
  user_profiles?: { full_name: string; role: string; employee_id: string | null };
}

interface UserProfile { id: string; full_name: string; employee_id: string | null; }

// Name and employee ID of whoever made the change (PIN users included).
// Falls back to System only when the database recorded no actor.
function actorName(e: AuditEntry): string {
  const p = e.user_profiles;
  if (p?.full_name) return p.full_name;
  return e.user_id ? e.user_id.slice(0, 8) : 'System';
}

function actorLabel(e: AuditEntry): string {
  const p = e.user_profiles;
  if (!p?.full_name) return actorName(e);
  return p.employee_id ? `${p.full_name} (${p.employee_id})` : p.full_name;
}

const MODULE_COLORS: Record<string, string> = {
  tasks: 'bg-blue-100 text-blue-700',
  attendance: 'bg-emerald-100 text-emerald-700',
  leave: 'bg-amber-100 text-amber-700',
  expenses: 'bg-rose-100 text-rose-700',
  support: 'bg-orange-100 text-orange-700',
  calendar: 'bg-cyan-100 text-cyan-700',
  payroll: 'bg-teal-100 text-teal-700',
  documents: 'bg-indigo-100 text-indigo-700',
  settings: 'bg-slate-200 text-slate-700',
  users: 'bg-purple-100 text-purple-700',
};

// Modules the database triggers write (must match audit_row_change in the SQL)
const MODULES = ['tasks', 'attendance', 'leave', 'expenses', 'support', 'calendar', 'payroll', 'documents', 'users', 'settings'];

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  SELECT: 'bg-slate-100 text-slate-600',
};

function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmtDT(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return d; }
}

export default function AuditLogPage() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [viewingEntry, setViewingEntry] = useState<AuditEntry | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Filters
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [userFilter, setUserFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('user_profiles').select('id, full_name, employee_id').order('full_name').then(({ data }) => {
      if (data) setUsers(data);
    });
  }, [effectiveUserId]);

  const fetchLogs = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      let q = supabase
        .from('audit_log')
        .select('*, user_profiles(full_name, role, employee_id)', { count: 'exact' })
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (userFilter !== 'all') q = q.eq('actor_id', userFilter);
      if (moduleFilter !== 'all') q = q.eq('module', moduleFilter);
      if (actionFilter !== 'all') q = q.eq('action', actionFilter);

      const { data, error, count } = await q;
      if (error) throw error;

      // Map audit_log columns onto the names this page displays
      const mapped: AuditEntry[] = (data || []).map((r: any) => ({
        id: r.id,
        user_id: r.actor_id,
        action: r.action,
        table_name: r.target_table || '',
        record_id: r.target_id,
        old_values: r.old_data,
        new_values: r.new_data,
        ip_address: r.ip_address,
        module: r.module,
        created_at: r.created_at,
        user_profiles: r.user_profiles,
      }));

      let filtered = mapped;
      if (searchQuery) {
        const q2 = searchQuery.toLowerCase();
        filtered = filtered.filter((e: AuditEntry) =>
          e.action?.toLowerCase().includes(q2) ||
          e.table_name?.toLowerCase().includes(q2) ||
          e.module?.toLowerCase().includes(q2) ||
          e.user_profiles?.full_name?.toLowerCase().includes(q2) ||
          e.user_profiles?.employee_id?.toLowerCase().includes(q2)
        );
      }

      setLogs(filtered);
      setTotalCount(count || 0);
    } catch (err: any) {
      toast.error('Could not load audit log: ' + (err?.message || 'unknown error'));
      setLogs([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, dateFrom, dateTo, userFilter, moduleFilter, actionFilter, searchQuery, page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleExportCSV = () => {
    if (logs.length === 0) { toast.error('No logs to export'); return; }
    const headers = ['Timestamp', 'User', 'Action', 'Module', 'Table', 'Record ID', 'IP Address', 'Old Value', 'New Value'];
    const rows = logs.map(l => [
      fmtDT(l.created_at),
      actorLabel(l),
      l.action,
      l.module || l.table_name || '—',
      l.table_name,
      l.record_id || '—',
      l.ip_address || '—',
      l.old_values ? JSON.stringify(l.old_values) : '—',
      l.new_values ? JSON.stringify(l.new_values) : '—',
    ]);
    downloadCSV(`audit-log-${dateFrom}-to-${dateTo}.csv`, headers, rows);
    toast.success('Audit log exported');
  };

  const modules = MODULES;

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Shield size={16} className="text-slate-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Audit Log</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Read-Only</span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Immutable record of all system actions — no editing or deletion permitted</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLogs} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold transition-colors">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Entries', value: totalCount, color: 'text-slate-700', bg: 'bg-white border-slate-200' },
          { label: 'Showing', value: logs.length, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
          { label: 'Date Range', value: `${dateFrom} → ${dateTo}`, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', small: true },
          { label: 'Modules Tracked', value: modules.length, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg} dark:bg-slate-800 dark:border-slate-700`}>
            <p className={`${s.small ? 'text-sm' : 'text-2xl'} font-bold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 mb-5 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">User</label>
            <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setPage(0); }}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.employee_id ? `${u.full_name} (${u.employee_id})` : u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Module</label>
            <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(0); }}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Modules</option>
              {modules.map(m => <option key={m} value={m} className="capitalize">{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Action</label>
            <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(0); }}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              <option value="all">All Actions</option>
              <option value="INSERT">Insert</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
            </select>
          </div>
        </div>
        <div className="mt-3 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(0); }} placeholder="Search by name, employee ID, action, module…"
            className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-slate-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Audit Entries — {logs.length} shown</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400">
              ← Prev
            </button>
            <span className="text-xs text-slate-500">Page {page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400">
              Next →
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Shield size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-semibold">No audit entries found</p>
            <p className="text-xs mt-1">Audit logging may not be configured yet, or no actions match the filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50">
                  {['Timestamp', 'User', 'Action', 'Module', 'Table', 'Record ID', 'IP Address', 'Details'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {logs.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-400 font-mono text-[11px]">{fmtDT(entry.created_at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{actorName(entry)}</p>
                      {entry.user_profiles?.employee_id && (
                        <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{entry.user_profiles.employee_id}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${ACTION_COLORS[entry.action] || 'bg-slate-100 text-slate-600'}`}>{entry.action}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${MODULE_COLORS[entry.module || ''] || 'bg-slate-100 text-slate-600'}`}>{entry.module || entry.table_name || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap font-mono text-[11px]">{entry.table_name}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap font-mono text-[11px]">{entry.record_id?.slice(0, 8) || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap font-mono text-[11px]">{entry.ip_address || '—'}</td>
                    <td className="px-3 py-2.5">
                      {(entry.old_values || entry.new_values) && (
                        <button onClick={() => setViewingEntry(entry)}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold">
                          <Eye size={12} /> View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {viewingEntry && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Audit Entry Details</h3>
              <button onClick={() => setViewingEntry(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">Timestamp</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{fmtDT(viewingEntry.created_at)}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">User</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{actorName(viewingEntry)}</p>
                  {viewingEntry.user_profiles?.employee_id && (
                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{viewingEntry.user_profiles.employee_id}</p>
                  )}
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">Action</p>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${ACTION_COLORS[viewingEntry.action] || 'bg-slate-100 text-slate-600'}`}>{viewingEntry.action}</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">Module / Table</p>
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{viewingEntry.module || viewingEntry.table_name}</p>
                </div>
              </div>
              {viewingEntry.old_values && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Old Values</p>
                  <pre className="text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 overflow-x-auto text-red-800 dark:text-red-300 whitespace-pre-wrap">
                    {JSON.stringify(viewingEntry.old_values, null, 2)}
                  </pre>
                </div>
              )}
              {viewingEntry.new_values && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">New Values</p>
                  <pre className="text-xs bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 overflow-x-auto text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap">
                    {JSON.stringify(viewingEntry.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
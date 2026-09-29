'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Plus, Search, X, Building2, Flag, CheckCircle2, Clock, RefreshCw, Eye } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface DiscrepancyReport {
  id: string;
  reported_by: string;
  client_org_id: string | null;
  client_name: string;
  discrepancy_type: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  assigned_to: string | null;
  resolution_notes: string;
  resolved_at: string | null;
  created_at: string;
  reporter?: { full_name: string; department: string };
  assignee?: { full_name: string };
}

interface ClientOrg {
  id: string;
  name: string;
}

interface UserProfile {
  id: string;
  full_name: string;
  role: string;
  department: string;
}

const severityConfig = {
  low: { label: 'Low', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

const statusConfig = {
  open:                { label: 'Open',                color: 'bg-blue-100 text-blue-700',    icon: AlertTriangle },
  in_progress:         { label: 'In Progress',         color: 'bg-indigo-100 text-indigo-700', icon: Clock },
  investigating:       { label: 'Investigating',       color: 'bg-amber-100 text-amber-700',  icon: Clock },
  pending_clarification: { label: 'Pending Clarification', color: 'bg-orange-100 text-orange-700', icon: Clock },
  resolved:            { label: 'Resolved',            color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  closed:              { label: 'Closed',              color: 'bg-slate-100 text-slate-600',  icon: CheckCircle2 },
  rejected:            { label: 'Rejected',            color: 'bg-red-100 text-red-700',      icon: AlertTriangle },
};

const DISCREPANCY_TYPES = ['Billing Error', 'Data Mismatch', 'Service Issue', 'Communication Gap', 'Compliance Issue', 'Payment Dispute', 'Contract Violation', 'Quality Issue', 'Other'];

const defaultForm = {
  client_name: '',
  client_org_id: '',
  discrepancy_type: 'Billing Error',
  title: '',
  description: '',
  severity: 'medium' as const,
};

export default function ClientDiscrepancyReports() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();

  const [reports, setReports] = useState<DiscrepancyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('employee');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [clientOrgs, setClientOrgs] = useState<ClientOrg[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [viewingReport, setViewingReport] = useState<DiscrepancyReport | null>(null);
  const [editingReport, setEditingReport] = useState<DiscrepancyReport | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const { data: visibleFirmIds } = await supabase.rpc('get_visible_firm_ids', { p_user_id: effectiveUserId, p_module: 'all' });

      let reportsQuery = supabase.from('client_discrepancy_reports')
        .select('*, reporter:reported_by(full_name, department), assignee:assigned_to(full_name)')
        .order('created_at', { ascending: false });
      let orgsQuery = supabase.from('client_organisations').select('id, name').order('name');
      let usersQuery = supabase.from('user_profiles').select('id, full_name, role, department').order('full_name');
      if (visibleFirmIds) {
        reportsQuery = reportsQuery.in('firm_id', visibleFirmIds);
        orgsQuery = orgsQuery.in('firm_id', visibleFirmIds);
        usersQuery = usersQuery.in('firm_id', visibleFirmIds);
      }

      const [profileRes, reportsRes, orgsRes, usersRes] = await Promise.all([
        supabase.from('user_profiles').select('role').eq('id', effectiveUserId).single(),
        reportsQuery,
        orgsQuery,
        usersQuery,
      ]);
      if (profileRes.data) setUserRole(profileRes.data.role);
      setReports((reportsRes.data || []) as DiscrepancyReport[]);
      setClientOrgs(orgsRes.data || []);
      setAllUsers(usersRes.data || []);
    } catch (err: any) {
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Please fill in title and description'); return;
    }
    if (!form.client_name.trim() && !form.client_org_id) {
      toast.error('Please specify a client name or select a client organisation'); return;
    }
    if (!effectiveUserId) return;
    setSubmitting(true);
    try {
      const clientName = form.client_org_id
        ? (clientOrgs.find(o => o.id === form.client_org_id)?.name || form.client_name)
        : form.client_name;
      const { data: reporterProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', effectiveUserId).single();
      const { error } = await supabase.from('client_discrepancy_reports').insert({
        reported_by: effectiveUserId,
        firm_id: reporterProfile?.firm_id || null,
        client_org_id: form.client_org_id || null,
        client_name: clientName,
        discrepancy_type: form.discrepancy_type,
        title: form.title,
        description: form.description,
        severity: form.severity,
        status: 'open',
      });
      if (error) throw error;
      toast.success('Discrepancy report submitted');
      setForm(defaultForm);
      setShowForm(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (reportId: string, newStatus: string) => {
    setProcessingId(reportId);
    try {
      const updates: any = { status: newStatus };
      if (newStatus === 'resolved') {
        updates.resolved_at = new Date().toISOString();
        updates.resolution_notes = resolutionNotes;
      }
      const { error } = await supabase.from('client_discrepancy_reports').update(updates).eq('id', reportId);
      if (error) throw error;
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, ...updates } : r));
      setViewingReport(null);
      setResolutionNotes('');
      toast.success(`Report marked as ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setProcessingId(null);
    }
  };

  const handleAssign = async (reportId: string, userId: string) => {
    try {
      const { error } = await supabase.from('client_discrepancy_reports').update({ assigned_to: userId || null }).eq('id', reportId);
      if (error) throw error;
      const assignee = allUsers.find(u => u.id === userId);
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, assigned_to: userId, assignee: assignee ? { full_name: assignee.full_name } : undefined } : r));
      toast.success('Report assigned');
    } catch (err: any) {
      toast.error('Failed to assign report');
    }
  };

  const filtered = reports.filter(r => {
    const matchSearch = !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.client_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchSeverity = severityFilter === 'all' || r.severity === severityFilter;
    return matchSearch && matchStatus && matchSeverity;
  });

  const stats = {
    total: reports.length,
    open: reports.filter(r => r.status === 'open').length,
    investigating: reports.filter(r => r.status === 'investigating').length,
    resolved: reports.filter(r => r.status === 'resolved' || r.status === 'closed').length,
    critical: reports.filter(r => r.severity === 'critical').length,
  };

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <AlertTriangle size={16} className="text-orange-600" />
            </div>
            <h1 className="text-2xl font-700 text-slate-900 dark:text-slate-100">Client Discrepancy Reports</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Report and track discrepancies noticed in client accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-600 transition-colors">
            <Plus size={16} /> Report Discrepancy
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-700', bg: 'bg-white border-slate-200' },
          { label: 'Open', value: stats.open, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
          { label: 'Investigating', value: stats.investigating, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
          { label: 'Resolved', value: stats.resolved, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
          { label: 'Critical', value: stats.critical, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
        ].map(stat => (
          <div key={stat.label} className={`rounded-xl border p-4 ${stat.bg}`}>
            <p className={`text-2xl font-700 tabular-nums ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search reports…"
            className="w-full text-sm pl-9 pr-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:ring-2 focus:ring-orange-300 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="investigating">Investigating</option>
          <option value="pending_clarification">Pending Clarification</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800">
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 py-16 text-center">
          <AlertTriangle size={40} className="text-slate-300 mx-auto mb-3" />
          <p className="text-base font-600 text-slate-600 dark:text-slate-400">No discrepancy reports found</p>
          <p className="text-sm text-slate-400 mt-1">Click "Report Discrepancy" to log a new issue</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(report => {
            const sev = severityConfig[report.severity];
            const stat = statusConfig[report.status];
            const StatIcon = stat.icon;
            return (
              <div key={report.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4 p-4">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${sev.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="text-sm font-700 text-slate-900 dark:text-slate-100">{report.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <Building2 size={11} className="inline mr-1" />{report.client_name}
                          <span className="mx-1.5">·</span>{report.discrepancy_type}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${sev.color}`}>{sev.label}</span>
                        <span className={`flex items-center gap-1 text-[10px] font-600 px-1.5 py-0.5 rounded-full ${stat.color}`}>
                          <StatIcon size={9} />{stat.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{report.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                      <span>By: {(report.reporter as any)?.full_name || 'Unknown'}</span>
                      {report.assignee && <span>· Assigned: {(report.assignee as any)?.full_name}</span>}
                      <span>· {new Date(report.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setViewingReport(report)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                      <Eye size={14} />
                    </button>
                    {(userRole === 'director' || userRole === 'manager') && (
                      <select value={report.status} onChange={e => handleUpdateStatus(report.id, e.target.value)}
                        disabled={processingId === report.id}
                        className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 outline-none text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 disabled:opacity-50">
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="investigating">Investigating</option>
                        <option value="pending_clarification">Pending Clarification</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Report Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Report Client Discrepancy</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Client Organisation</label>
                <select value={form.client_org_id} onChange={e => setForm(f => ({ ...f, client_org_id: e.target.value, client_name: e.target.value ? '' : f.client_name }))}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700">
                  <option value="">— Select or type below —</option>
                  {clientOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              {!form.client_org_id && (
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Client Name *</label>
                  <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                    placeholder="Enter client name" className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Type</label>
                  <select value={form.discrepancy_type} onChange={e => setForm(f => ({ ...f, discrepancy_type: e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700">
                    {DISCREPANCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Severity</label>
                  <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as any }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Title *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Brief description of the discrepancy" className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
              </div>
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Description *</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Provide detailed information about the discrepancy…" rows={4}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 resize-none bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                <Flag size={14} />
                {submitting ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Report Modal */}
      {viewingReport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Report Details</h3>
              <button onClick={() => setViewingReport(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-600 px-2 py-1 rounded-full ${severityConfig[viewingReport.severity].color}`}>{severityConfig[viewingReport.severity].label}</span>
                <span className={`text-xs font-600 px-2 py-1 rounded-full ${statusConfig[viewingReport.status].color}`}>{statusConfig[viewingReport.status].label}</span>
                <span className="text-xs text-slate-500">{viewingReport.discrepancy_type}</span>
              </div>
              <div>
                <p className="text-lg font-700 text-slate-900 dark:text-slate-100">{viewingReport.title}</p>
                <p className="text-sm text-slate-500 mt-0.5"><Building2 size={12} className="inline mr-1" />{viewingReport.client_name}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-4">
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{viewingReport.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">Reported By</p>
                  <p className="font-600 text-slate-700 dark:text-slate-300">{(viewingReport.reporter as any)?.full_name || 'Unknown'}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-0.5">Reported On</p>
                  <p className="font-600 text-slate-700 dark:text-slate-300">{new Date(viewingReport.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
              {(userRole === 'director' || userRole === 'manager') && (
                <>
                  <div>
                    <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Assign To</label>
                    <select value={viewingReport.assigned_to || ''} onChange={e => handleAssign(viewingReport.id, e.target.value)}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700">
                      <option value="">— Unassigned —</option>
                      {allUsers.filter(u => ['director', 'manager'].includes(u.role)).map(u => (
                        <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                  {viewingReport.status !== 'resolved' && viewingReport.status !== 'closed' && (
                    <div>
                      <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Resolution Notes</label>
                      <textarea value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)}
                        placeholder="Describe how this was resolved…" rows={3}
                        className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 resize-none bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    {viewingReport.status === 'open' && (
                      <button onClick={() => handleUpdateStatus(viewingReport.id, 'investigating')} disabled={processingId === viewingReport.id}
                        className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                        Mark Investigating
                      </button>
                    )}
                    {viewingReport.status === 'investigating' && (
                      <button onClick={() => handleUpdateStatus(viewingReport.id, 'in_progress')} disabled={processingId === viewingReport.id}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                        Mark In Progress
                      </button>
                    )}
                    {!['resolved', 'closed', 'rejected'].includes(viewingReport.status) && (
                      <button onClick={() => handleUpdateStatus(viewingReport.id, 'resolved')} disabled={processingId === viewingReport.id}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                        Mark Resolved
                      </button>
                    )}
                    {viewingReport.status === 'resolved' && (
                      <button onClick={() => handleUpdateStatus(viewingReport.id, 'closed')} disabled={processingId === viewingReport.id}
                        className="flex-1 py-2.5 rounded-xl bg-slate-600 hover:bg-slate-700 text-white text-sm font-600 transition-colors disabled:opacity-60">
                        Close Report
                      </button>
                    )}
                  </div>
                </>
              )}
              {viewingReport.resolution_notes && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                  <p className="text-xs font-600 text-emerald-700 dark:text-emerald-400 mb-1">Resolution Notes</p>
                  <p className="text-sm text-emerald-800 dark:text-emerald-300">{viewingReport.resolution_notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, Plus, Search, Clock, CheckCircle2, AlertCircle, XCircle, X, Loader2 } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface SupportTicket {
  id: string;
  ticket_number: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assigned_to: string | null;
  resolution_notes: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  user_profiles?: { full_name: string; department: string };
}

const CATEGORIES = ['General', 'IT Support', 'HR', 'Payroll', 'Facilities', 'Access & Permissions', 'Equipment', 'Other'];

const priorityConfig = {
  low: { label: 'Low', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  high: { label: 'High', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

const statusConfig = {
  open: { label: 'Open', color: 'bg-blue-100 text-blue-700', icon: AlertCircle },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-600', icon: XCircle },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function TicketCentre() {
  const { user, getUserProfile, effectiveUserId } = useAuth();
  const supabase = createClient();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('employee');
  const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [form, setForm] = useState({ title: '', description: '', category: 'General', priority: 'medium' as const });
  const [resolutionNote, setResolutionNote] = useState('');

  const fetchTickets = useCallback(async (role: string) => {
    if (!user) {
      // Try PIN session
      try {
        const stored = localStorage.getItem('dgaj_pin_session');
        if (stored) {
          const parsed = JSON.parse(stored);
          const uid = parsed?.userId;
          if (uid) {
            setLoading(true);
            let query = supabase.from('support_tickets').select('*, user_profiles!support_tickets_user_id_fkey(full_name, department)').order('created_at', { ascending: false });
            const { data: visibleFirmIds } = await supabase.rpc('get_visible_firm_ids', { p_user_id: uid, p_module: 'all' });
            if (visibleFirmIds) query = query.in('firm_id', visibleFirmIds);
            const { data, error } = await query;
            if (error) throw error;
            setTickets(data || []);
            setLoading(false);
            return;
          }
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to load tickets');
      }
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('support_tickets').select('*, user_profiles!support_tickets_user_id_fkey(full_name, department)').order('created_at', { ascending: false });
      const { data: visibleFirmIds } = await supabase.rpc('get_visible_firm_ids', { p_user_id: user.id, p_module: 'all' });
      if (visibleFirmIds) query = query.in('firm_id', visibleFirmIds);
      const { data, error } = await query;
      if (error) throw error;
      setTickets(data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [user, supabase]);

  useEffect(() => {
    const init = async () => {
      if (!user) {
        // Try PIN session
        try {
          const stored = localStorage.getItem('dgaj_pin_session');
          if (stored) {
            const parsed = JSON.parse(stored);
            const uid = parsed?.userId;
            if (uid) {
              const { data } = await supabase.from('user_profiles').select('role').eq('id', uid).single();
              const role = data?.role || 'employee';
              setUserRole(role);
              fetchTickets(role);
              return;
            }
          }
        } catch {}
        setLoading(false);
        return;
      }
      try {
        const profile = await getUserProfile();
        const role = profile?.role || 'employee';
        setUserRole(role);
        fetchTickets(role);
      } catch {
        fetchTickets('employee');
      }
    };
    init();
  }, [user]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) { toast.error('Please fill in title and description'); return; }
    const uid = effectiveUserId;
    if (!uid) { toast.error('Not authenticated'); return; }
    setSubmitting(true);
    try {
      const { data: submitterProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', uid).single();
      const { error } = await supabase.from('support_tickets').insert({
        user_id: uid,
        firm_id: submitterProfile?.firm_id || null,
        title: form.title,
        description: form.description,
        category: form.category,
        priority: form.priority,
        status: 'open',
      });
      if (error) throw error;
      toast.success('Ticket submitted successfully');
      setForm({ title: '', description: '', category: 'General', priority: 'medium' });
      setShowForm(false);
      fetchTickets(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
    setUpdatingId(ticketId);
    try {
      const updates: any = { status: newStatus };
      if (newStatus === 'resolved') {
        updates.resolution_notes = resolutionNote;
        updates.resolved_at = new Date().toISOString();
      }
      const { error } = await supabase.from('support_tickets').update(updates).eq('id', ticketId);
      if (error) throw error;
      toast.success(`Ticket marked as ${newStatus}`);
      setSelectedTicket(null);
      setResolutionNote('');
      fetchTickets(userRole);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update ticket');
    } finally {
      setUpdatingId(null);
    }
  };

  const isDirectorOrManager = userRole === 'director' || userRole === 'manager';

  const displayTickets = tickets.filter((t) => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchSearch = !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.ticket_number?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchTab = activeTab === 'my' ? t.user_id === effectiveUserId : true;
    return matchStatus && matchSearch && matchTab;
  });

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const inProgressCount = tickets.filter((t) => t.status === 'in_progress').length;

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <Ticket size={16} className="text-orange-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Ticket Centre</h1>
            </div>
            <p className="text-sm text-slate-500">Raise and track internal support requests</p>
          </div>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            <Plus size={15} /> New Ticket
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total', value: tickets.length, color: 'text-slate-700', bg: 'bg-slate-50' },
            { label: 'Open', value: openCount, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'In Progress', value: inProgressCount, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Resolved', value: tickets.filter((t) => t.status === 'resolved').length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs + Filters */}
        {isDirectorOrManager && (
          <div className="flex gap-1 border-b border-slate-200 mb-4">
            {[{ id: 'my', label: 'My Tickets' }, { id: 'all', label: 'All Tickets' }].map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${activeTab === tab.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search tickets…"
              className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-300 text-slate-800" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 bg-white">
            <option value="all">All Status</option>
            {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Ticket List */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-orange-500" /></div>
          ) : displayTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Ticket size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-semibold">No tickets found</p>
              <p className="text-xs mt-1">Click "New Ticket" to raise a support request</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayTickets.map((ticket) => {
                const sc = statusConfig[ticket.status];
                const pc = priorityConfig[ticket.priority];
                const StatusIcon = sc.icon;
                return (
                  <div key={ticket.id} onClick={() => setSelectedTicket(ticket)}
                    className="flex items-start gap-3 px-5 py-4 hover:bg-slate-50 transition-colors cursor-pointer">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${pc.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-semibold text-slate-900">{ticket.title}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${pc.color}`}>{pc.label}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{ticket.description}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-slate-400 font-mono">{ticket.ticket_number || 'TKT-PENDING'}</span>
                        <span className="text-[11px] text-slate-400">{ticket.category}</span>
                        {isDirectorOrManager && ticket.user_profiles && (
                          <span className="text-[11px] text-slate-400">{ticket.user_profiles.full_name}</span>
                        )}
                        <span className="text-[11px] text-slate-400 ml-auto">{timeAgo(ticket.created_at)}</span>
                      </div>
                    </div>
                    <StatusIcon size={16} className={`flex-shrink-0 mt-1 ${sc.color.split(' ')[1]}`} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900">Raise a Support Ticket</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} className="text-slate-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Title *</label>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Brief description of the issue" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-800" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Description *</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Describe the issue in detail…"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-800 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Category</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 bg-white">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as any }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-300 text-slate-700 bg-white">
                    {Object.entries(priorityConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleSubmit} disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Ticket size={15} />}
                {submitting ? 'Submitting…' : 'Submit Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedTicket(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-mono text-slate-400 mb-1">{selectedTicket.ticket_number || 'TKT-PENDING'}</p>
                <h3 className="text-base font-bold text-slate-900">{selectedTicket.title}</h3>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"><X size={16} className="text-slate-500" /></button>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusConfig[selectedTicket.status].color}`}>{statusConfig[selectedTicket.status].label}</span>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${priorityConfig[selectedTicket.priority].color}`}>{priorityConfig[selectedTicket.priority].label} Priority</span>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">{selectedTicket.category}</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed mb-4">{selectedTicket.description}</p>
            {selectedTicket.resolution_notes && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4">
                <p className="text-xs font-semibold text-emerald-700 mb-1">Resolution Notes</p>
                <p className="text-xs text-emerald-800">{selectedTicket.resolution_notes}</p>
              </div>
            )}
            <p className="text-xs text-slate-400 mb-4">Submitted {timeAgo(selectedTicket.created_at)}</p>
            {isDirectorOrManager && selectedTicket.status !== 'closed' && (
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-slate-600">Update Status</p>
                {selectedTicket.status === 'open' && (
                  <button onClick={() => handleUpdateStatus(selectedTicket.id, 'in_progress')} disabled={updatingId === selectedTicket.id}
                    className="w-full flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-sm font-semibold py-2 rounded-xl transition-colors disabled:opacity-60">
                    <Clock size={14} /> Mark In Progress
                  </button>
                )}
                {(selectedTicket.status === 'open' || selectedTicket.status === 'in_progress') && (
                  <>
                    <textarea value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                      rows={2} placeholder="Resolution notes (optional)…"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-300 text-slate-800 resize-none" />
                    <button onClick={() => handleUpdateStatus(selectedTicket.id, 'resolved')} disabled={updatingId === selectedTicket.id}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-sm font-semibold py-2 rounded-xl transition-colors disabled:opacity-60">
                      <CheckCircle2 size={14} /> Mark Resolved
                    </button>
                  </>
                )}
                {selectedTicket.status === 'resolved' && (
                  <button onClick={() => handleUpdateStatus(selectedTicket.id, 'closed')} disabled={updatingId === selectedTicket.id}
                    className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold py-2 rounded-xl transition-colors disabled:opacity-60">
                    <XCircle size={14} /> Close Ticket
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Command, CheckCircle2, AlertTriangle, BellRing, CalendarDays, Receipt, Ticket, TrendingUp, TrendingDown, ChevronRight, Loader2, RefreshCw, Check, X, Megaphone, Shield, BarChart3, UserCog, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast, Toaster } from 'sonner';
import Link from 'next/link';
import Icon from '@/components/ui/AppIcon';



interface PendingItem {
  id: string;
  type: 'leave' | 'expense' | 'ticket';
  employee_name: string;
  department: string;
  detail: string;
  amount?: string;
  urgency: 'high' | 'medium' | 'normal';
  submitted_at: string;
  status: string;
}

interface TeamStat {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bg: string;
  trend?: 'up' | 'down' | 'neutral';
}

const urgencyConfig = {
  high: { label: 'Urgent', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  normal: { label: 'Normal', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};

const typeConfig = {
  leave: { label: 'Leave', color: 'bg-blue-100 text-blue-700', icon: CalendarDays },
  expense: { label: 'Expense', color: 'bg-purple-100 text-purple-700', icon: Receipt },
  ticket: { label: 'Ticket', color: 'bg-orange-100 text-orange-700', icon: Ticket },
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

export default function DirectorCommandHub() {
  const { user, pinSession, effectiveUserId, getUserProfile } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [pendingLeaves, setPendingLeaves] = useState<PendingItem[]>([]);
  const [pendingExpenses, setPendingExpenses] = useState<PendingItem[]>([]);
  const [openTickets, setOpenTickets] = useState<PendingItem[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [reminderSending, setReminderSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [announcementSending, setAnnouncementSending] = useState(false);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const subscriptionsRef = useRef<any[]>([]);

  const mapLeave = (l: any): PendingItem => ({
    id: l.id,
    type: 'leave' as const,
    employee_name: l.user_profiles?.full_name || 'Unknown',
    department: l.user_profiles?.department || '',
    detail: `${l.leave_type} leave · ${new Date(l.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(l.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
    urgency: 'normal' as const,
    submitted_at: l.created_at,
    status: 'pending',
  });

  const mapExpense = (e: any): PendingItem => ({
    id: e.id,
    type: 'expense' as const,
    employee_name: e.user_profiles?.full_name || 'Unknown',
    department: e.user_profiles?.department || '',
    detail: `${e.title} · ${e.category}`,
    amount: `₹${Number(e.amount).toLocaleString('en-IN')}`,
    urgency: 'normal' as const,
    submitted_at: e.created_at,
    status: 'pending',
  });

  const mapTicket = (t: any): PendingItem => ({
    id: t.id,
    type: 'ticket' as const,
    employee_name: t.user_profiles?.full_name || 'Unknown',
    department: t.user_profiles?.department || '',
    detail: `${t.title} · ${t.category}`,
    urgency: (t.priority === 'urgent' ? 'high' : t.priority === 'high' ? 'medium' : 'normal') as 'high' | 'medium' | 'normal',
    submitted_at: t.created_at,
    status: t.status,
  });

  const fetchData = useCallback(async () => {
    if (!effectiveUserId) return;
    try {
      const { data: leaves } = await supabase
        .from('leave_requests')
        .select('id, leave_type, start_date, end_date, reason, created_at, user_profiles(full_name, department)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);

      if (leaves) setPendingLeaves(leaves.map(mapLeave));

      const { data: expenses } = await supabase
        .from('expenses')
        .select('id, title, amount, category, created_at, user_profiles(full_name, department)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);

      if (expenses) setPendingExpenses(expenses.map(mapExpense));

      const { data: tickets } = await supabase
        .from('support_tickets')
        .select('id, ticket_number, title, category, priority, created_at, user_profiles(full_name, department)')
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (tickets) setOpenTickets(tickets.map(mapTicket));
    } catch (err) {
      console.error('Error fetching command hub data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveUserId]);

  const setupSubscriptions = useCallback(() => {
    subscriptionsRef.current.forEach((sub) => {
      try { supabase.removeChannel(sub); } catch {}
    });
    subscriptionsRef.current = [];

    const leavesSub = supabase
      .channel('cmd-leaves-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leave_requests', filter: 'status=eq.pending' }, async (payload) => {
        const { data } = await supabase
          .from('leave_requests')
          .select('id, leave_type, start_date, end_date, reason, created_at, user_profiles(full_name, department)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setPendingLeaves((prev) => {
            if (prev.find((l) => l.id === data.id)) return prev;
            return [mapLeave(data), ...prev];
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leave_requests' }, (payload) => {
        if (payload.new.status !== 'pending') {
          setPendingLeaves((prev) => prev.filter((l) => l.id !== payload.new.id));
        }
      })
      .subscribe();

    const expensesSub = supabase
      .channel('cmd-expenses-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'expenses', filter: 'status=eq.pending' }, async (payload) => {
        const { data } = await supabase
          .from('expenses')
          .select('id, title, amount, category, created_at, user_profiles(full_name, department)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setPendingExpenses((prev) => {
            if (prev.find((e) => e.id === data.id)) return prev;
            return [mapExpense(data), ...prev];
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expenses' }, (payload) => {
        if (payload.new.status !== 'pending') {
          setPendingExpenses((prev) => prev.filter((e) => e.id !== payload.new.id));
        }
      })
      .subscribe();

    const ticketsSub = supabase
      .channel('cmd-tickets-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_tickets' }, async (payload) => {
        if (!['open', 'in_progress'].includes(payload.new.status)) return;
        const { data } = await supabase
          .from('support_tickets')
          .select('id, ticket_number, title, category, priority, created_at, user_profiles(full_name, department)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setOpenTickets((prev) => {
            if (prev.find((t) => t.id === data.id)) return prev;
            return [mapTicket(data), ...prev];
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_tickets' }, (payload) => {
        if (!['open', 'in_progress'].includes(payload.new.status)) {
          setOpenTickets((prev) => prev.filter((t) => t.id !== payload.new.id));
        }
      })
      .subscribe();

    subscriptionsRef.current = [leavesSub, expensesSub, ticketsSub];
  }, [supabase]);

  useEffect(() => {
    getUserProfile().then(setUserProfile).catch(() => {});
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!effectiveUserId) return;
    setupSubscriptions();
    return () => {
      subscriptionsRef.current.forEach((sub) => {
        try { supabase.removeChannel(sub); } catch {}
      });
      subscriptionsRef.current = [];
    };
  }, [effectiveUserId, setupSubscriptions]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleApproveLeave = async (item: PendingItem) => {
    setProcessingId(item.id);
    try {
      const { error } = await supabase
        .from('leave_requests')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      setPendingLeaves((prev) => prev.filter((l) => l.id !== item.id));
      toast.success(`Leave approved for ${item.employee_name}`);
    } catch {
      toast.error('Failed to approve leave');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectLeave = async (item: PendingItem) => {
    setProcessingId(item.id);
    try {
      const { error } = await supabase
        .from('leave_requests')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      setPendingLeaves((prev) => prev.filter((l) => l.id !== item.id));
      toast.error(`Leave rejected for ${item.employee_name}`);
    } catch {
      toast.error('Failed to reject leave');
    } finally {
      setProcessingId(null);
    }
  };

  const handleApproveExpense = async (item: PendingItem) => {
    setProcessingId(item.id);
    try {
      const { error } = await supabase
        .from('expenses')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      setPendingExpenses((prev) => prev.filter((e) => e.id !== item.id));
      toast.success(`Expense approved for ${item.employee_name}`);
    } catch {
      toast.error('Failed to approve expense');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectExpense = async (item: PendingItem) => {
    setProcessingId(item.id);
    try {
      const { error } = await supabase
        .from('expenses')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      setPendingExpenses((prev) => prev.filter((e) => e.id !== item.id));
      toast.error(`Expense rejected for ${item.employee_name}`);
    } catch {
      toast.error('Failed to reject expense');
    } finally {
      setProcessingId(null);
    }
  };

  const totalPending = pendingLeaves.length + pendingExpenses.length;
  const displayName = userProfile?.full_name || user?.email?.split('@')[0] || 'Director';

  const stats: TeamStat[] = [
    { label: 'Pending Leaves', value: pendingLeaves.length, icon: CalendarDays, color: 'text-blue-600', bg: 'bg-blue-50', trend: pendingLeaves.length > 3 ? 'up' : 'neutral' },
    { label: 'Pending Expenses', value: pendingExpenses.length, icon: Receipt, color: 'text-purple-600', bg: 'bg-purple-50', trend: pendingExpenses.length > 3 ? 'up' : 'neutral' },
    { label: 'Open Tickets', value: openTickets.length, icon: Ticket, color: 'text-orange-600', bg: 'bg-orange-50', trend: openTickets.length > 5 ? 'up' : 'neutral' },
    { label: 'Total Pending', value: totalPending, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', trend: totalPending > 5 ? 'up' : 'down' },
  ];

  const sendApprovalReminders = async () => {
    if (totalPending === 0) {
      toast('No pending items to remind about');
      return;
    }
    setReminderSending(true);
    try {
      const { data: managers } = await supabase
        .from('user_profiles')
        .select('id')
        .in('role', ['director', 'manager']);

      if (managers && managers.length > 0) {
        const notifications = managers.map((m: any) => ({
          user_id: m.id,
          type: 'approval_reminder',
          title: '⏰ Pending Approvals Reminder',
          message: `You have ${totalPending} item${totalPending !== 1 ? 's' : ''} awaiting your review — ${pendingLeaves.length} leave${pendingLeaves.length !== 1 ? 's' : ''}, ${pendingExpenses.length} expense${pendingExpenses.length !== 1 ? 's' : ''}, ${openTickets.length} ticket${openTickets.length !== 1 ? 's' : ''}.`,
          is_read: false,
        }));
        const { error } = await supabase.from('notifications').insert(notifications);
        if (error) throw error;
        toast.success(`Approval reminders sent to ${managers.length} manager${managers.length !== 1 ? 's' : ''}`);
      } else {
        toast('No managers found to notify');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send reminders');
    } finally {
      setReminderSending(false);
    }
  };

  const sendAnnouncement = async () => {
    if (!announcement.trim()) return;
    setAnnouncementSending(true);
    try {
      const { data: allUsers } = await supabase.from('user_profiles').select('id');
      if (allUsers && allUsers.length > 0) {
        const notifications = allUsers.map((u: any) => ({
          user_id: u.id,
          type: 'general',
          title: '📢 Company Announcement',
          message: announcement.trim(),
          is_read: false,
        }));
        const { error } = await supabase.from('notifications').insert(notifications);
        if (error) throw error;
        toast.success(`Announcement broadcast to ${allUsers.length} employee${allUsers.length !== 1 ? 's' : ''}`);
        setAnnouncement('');
        setShowAnnounce(false);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send announcement');
    } finally {
      setAnnouncementSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-blue-600" />
          <p className="text-sm text-slate-500 font-medium">Loading Command Hub…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster position="bottom-right" richColors />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
              <Command size={18} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Command Hub</h1>
          </div>
          <p className="text-sm text-slate-500">
            Director oversight · <span className="font-semibold text-slate-700">{displayName}</span> · {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-2 rounded-xl transition-colors hover:bg-slate-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={sendApprovalReminders}
            disabled={reminderSending}
            className="flex items-center gap-1.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl transition-colors"
          >
            {reminderSending ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
            Send Reminders
          </button>
          <button
            onClick={() => setShowAnnounce(!showAnnounce)}
            className="flex items-center gap-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors"
          >
            <Megaphone size={14} />
            Announce
          </button>
        </div>
      </div>

      {/* Announcement Form */}
      {showAnnounce && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone size={16} className="text-blue-600" />
            <p className="text-sm font-semibold text-blue-900">Broadcast Announcement to All Employees</p>
          </div>
          <textarea
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder="Type your announcement to all employees…"
            rows={3}
            className="w-full text-sm border border-blue-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-blue-600">This will send a notification to every employee in the system.</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowAnnounce(false); setAnnouncement(''); }}
                className="text-sm text-slate-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                Cancel
              </button>
              <button
                onClick={sendAnnouncement}
                disabled={!announcement.trim() || announcementSending}
                className="flex items-center gap-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {announcementSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {announcementSending ? 'Sending…' : 'Broadcast'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <Icon size={16} className={stat.color} />
                </div>
                {stat.trend === 'up' && <TrendingUp size={14} className="text-red-500" />}
                {stat.trend === 'down' && <TrendingDown size={14} className="text-emerald-500" />}
              </div>
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'User Management', icon: UserCog, href: '/user-management', color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Analytics', icon: BarChart3, href: '/analytics-reporting-dashboard', color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Expense Centre', icon: Receipt, href: '/expense-centre', color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Client Discrepancies', icon: AlertTriangle, href: '/client-discrepancy-reports', color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Ticket Centre', icon: Ticket, href: '/ticket-centre', color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Director Settings', icon: Shield, href: '/director-settings', color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: 'Live Locations', icon: BarChart3, href: '/live-location-map', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Attendance Audit', icon: BarChart3, href: '/attendance-audit', color: 'text-teal-600', bg: 'bg-teal-50' },
        ].map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:bg-slate-50 transition-colors group"
            >
              <div className={`w-8 h-8 rounded-lg ${link.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={15} className={link.color} />
              </div>
              <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 truncate">{link.label}</span>
              <ChevronRight size={14} className="text-slate-400 ml-auto flex-shrink-0" />
            </Link>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pending Leave Approvals */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900">Leave Approvals</h2>
              {pendingLeaves.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full px-2 py-0.5">{pendingLeaves.length}</span>
              )}
            </div>
            <Link href="/leave-management" className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {pendingLeaves.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <CheckCircle2 size={28} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">All caught up!</p>
                <p className="text-[11px]">No pending leave requests</p>
              </div>
            ) : (
              pendingLeaves.map((item) => (
                <PendingItemRow
                  key={item.id}
                  item={item}
                  processingId={processingId}
                  onApprove={() => handleApproveLeave(item)}
                  onReject={() => handleRejectLeave(item)}
                />
              ))
            )}
          </div>
        </div>

        {/* Pending Expense Approvals */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Receipt size={16} className="text-purple-600" />
              <h2 className="text-sm font-bold text-slate-900">Expense Approvals</h2>
              {pendingExpenses.length > 0 && (
                <span className="bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full px-2 py-0.5">{pendingExpenses.length}</span>
              )}
            </div>
            <Link href="/expense-centre" className="text-xs text-purple-600 font-semibold hover:underline flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {pendingExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <CheckCircle2 size={28} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">All caught up!</p>
                <p className="text-[11px]">No pending expense requests</p>
              </div>
            ) : (
              pendingExpenses.map((item) => (
                <PendingItemRow
                  key={item.id}
                  item={item}
                  processingId={processingId}
                  onApprove={() => handleApproveExpense(item)}
                  onReject={() => handleRejectExpense(item)}
                />
              ))
            )}
          </div>
        </div>

        {/* Open Tickets */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Ticket size={16} className="text-orange-600" />
              <h2 className="text-sm font-bold text-slate-900">Open Tickets</h2>
              {openTickets.length > 0 && (
                <span className="bg-orange-100 text-orange-700 text-[10px] font-bold rounded-full px-2 py-0.5">{openTickets.length}</span>
              )}
            </div>
            <Link href="/ticket-centre" className="text-xs text-orange-600 font-semibold hover:underline flex items-center gap-1">
              Manage tickets <ChevronRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {openTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <CheckCircle2 size={28} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">No open tickets</p>
                <p className="text-[11px]">All tickets are resolved</p>
              </div>
            ) : (
              openTickets.map((item) => {
                const urgCfg = urgencyConfig[item.urgency];
                const TypeIcon = typeConfig[item.type].icon;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <TypeIcon size={14} className="text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold text-slate-900 truncate">{item.employee_name}</p>
                        <span className="text-[10px] text-slate-400">{item.department}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{item.detail}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${urgCfg.color}`}>{urgCfg.label}</span>
                      <span className="text-[10px] text-slate-400">{timeAgo(item.submitted_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}

interface PendingItemRowProps {
  item: PendingItem;
  processingId: string | null;
  onApprove: () => void;
  onReject: () => void;
}

function PendingItemRow({ item, processingId, onApprove, onReject }: PendingItemRowProps) {
  const typeCfg = typeConfig[item.type];
  const TypeIcon = typeCfg.icon;
  const isProcessing = processingId === item.id;

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
      <div className={`w-8 h-8 rounded-xl ${item.type === 'leave' ? 'bg-blue-50' : 'bg-purple-50'} flex items-center justify-center flex-shrink-0`}>
        <TypeIcon size={14} className={item.type === 'leave' ? 'text-blue-600' : 'text-purple-600'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-semibold text-slate-900 truncate">{item.employee_name}</p>
          {item.amount && <span className="text-[10px] font-bold text-purple-700">{item.amount}</span>}
        </div>
        <p className="text-[11px] text-slate-500 truncate">{item.detail}</p>
        <p className="text-[10px] text-slate-400">{timeAgo(item.submitted_at)}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isProcessing ? (
          <Loader2 size={16} className="animate-spin text-slate-400" />
        ) : (
          <>
            <button
              onClick={onApprove}
              className="w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center transition-colors"
              title="Approve"
            >
              <Check size={13} className="text-emerald-600" />
            </button>
            <button
              onClick={onReject}
              className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
              title="Reject"
            >
              <X size={13} className="text-red-500" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

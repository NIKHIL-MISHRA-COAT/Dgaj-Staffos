'use client';
// v3 – force chunk rebuild 2026-08-17
// v2 – force chunk rebuild
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Crown, Users, AlertTriangle, CheckCircle2, Megaphone, TrendingDown, Clock, Activity, ChevronRight, X, Check, Bell } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface Employee {
  id: string;
  name: string;
  initials: string;
  department: string;
  designation: string;
  status: 'active' | 'inactive' | 'late' | 'on-leave';
  lastSeen: string;
  productivity: number;
  pendingTasks: number;
}

interface PendingApproval {
  id: string;
  type: 'leave' | 'expense' | 'complaint';
  employee: string;
  initials: string;
  department: string;
  detail: string;
  amount?: string;
  urgency: 'high' | 'medium' | 'normal';
  submittedAt: string;
  rawId: string;
}

const approvalTypeConfig = {
  leave: { labelKey: 'leaveRequest', color: 'bg-blue-100 text-blue-700' },
  expense: { labelKey: 'expenseCentreTitle', color: 'bg-purple-100 text-purple-700' },
  complaint: { labelKey: 'ticketCentreTitle', color: 'bg-orange-100 text-orange-700' },
};

const urgencyConfig = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  normal: 'bg-slate-100 text-slate-600',
};

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

const MY_STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  work_from_home: 'Work from home',
  late: 'Late',
  half_day: 'Half day',
  absent: 'Absent',
  paid_leave: 'Paid leave',
  unpaid_leave: 'Unpaid leave',
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

export default function DirectorControlPanel() {
  const { user, pinSession, effectiveUserId } = useAuth();
  const supabase = createClient();
  const [directorName, setDirectorName] = useState<string>('Director');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [showAnnounceForm, setShowAnnounceForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | Employee['status']>('all');
  const [loading, setLoading] = useState(true);
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [myToday, setMyToday] = useState<{
    status: string;
    clock_in: string | null;
    clock_out: string | null;
    total_hours: number | null;
  } | null>(null);
  const [myTodayLoading, setMyTodayLoading] = useState(true);
  const { t } = useLanguage();

  const statusConfig = {
    active: { label: t('present'), dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
    inactive: { label: t('inactive'), dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600' },
    late: { label: t('late'), dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
    'on-leave': { label: t('onLeave'), dot: 'bg-blue-400', badge: 'bg-blue-100 text-blue-700' },
  };

  useEffect(() => {
    if (!effectiveUserId) return;
    fetchDirectorName();
    fetchMyToday();
    fetchEmployees();
    fetchPendingApprovals();
  }, [effectiveUserId]);

  const fetchDirectorName = async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase.from('user_profiles').select('full_name').eq('id', effectiveUserId).single();
    if (data?.full_name) setDirectorName(data.full_name);
  };

  const fetchMyToday = async () => {
    if (!effectiveUserId) return;
    setMyTodayLoading(true);
    // Use the local date (IST), not toISOString(), which is UTC and can show yesterday before 5:30 AM
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('attendance_records')
      .select('status, clock_in, clock_out, total_hours')
      .eq('user_id', effectiveUserId)
      .eq('work_date', today)
      .maybeSingle();
    if (error) console.error('My attendance fetch error:', error);
    setMyToday(data ?? null);
    setMyTodayLoading(false);
  };

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, department, job_title, is_active')
        .eq('is_active', true)
        .neq('role', 'director')
        .order('full_name');

      const { data: attendance } = await supabase
        .from('attendance_records')
        .select('user_id, status, clock_in, clock_out')
        .eq('work_date', today);

      const { data: leaves } = await supabase
        .from('leave_requests')
        .select('user_id')
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today);

      const { data: tasks } = await supabase
        .from('tasks')
        .select('assigned_to, status')
        .neq('status', 'done');

      const attendanceMap: Record<string, string> = {};
      (attendance || []).forEach((a) => { attendanceMap[a.user_id] = a.status; });

      const leaveSet = new Set((leaves || []).map((l) => l.user_id));

      const taskCountMap: Record<string, number> = {};
      (tasks || []).forEach((t) => {
        if (t.assigned_to) taskCountMap[t.assigned_to] = (taskCountMap[t.assigned_to] || 0) + 1;
      });

      const empList: Employee[] = (profiles || []).map((p) => {
        let status: Employee['status'] = 'inactive';
        if (leaveSet.has(p.id)) status = 'on-leave';
        else if (attendanceMap[p.id] === 'present' || attendanceMap[p.id] === 'work_from_home') status = 'active';
        else if (attendanceMap[p.id] === 'late') status = 'late';

        const attStatus = attendanceMap[p.id];
        const productivity = attStatus === 'present' ? 85 : attStatus === 'late' ? 60 : attStatus === 'work_from_home' ? 80 : 0;

        return {
          id: p.id,
          name: p.full_name,
          initials: getInitials(p.full_name),
          department: p.department || 'General',
          designation: p.job_title || 'Employee',
          status,
          lastSeen: attStatus ? `Today · ${attStatus}` : 'Not clocked in',
          productivity,
          pendingTasks: taskCountMap[p.id] || 0,
        };
      });

      setEmployees(empList);
    } catch (err) {
      console.error('Employee fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingApprovals = async () => {
    try {
      const [leavesRes, expensesRes, ticketsRes] = await Promise.all([
        supabase.from('leave_requests').select('id, user_id, leave_type, start_date, end_date, total_days, created_at, user_profiles!leave_requests_user_id_fkey(full_name, department)').eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
        supabase.from('expenses').select('id, user_id, title, amount, currency, created_at, user_profiles!expenses_user_id_fkey(full_name, department)').eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
        supabase.from('support_tickets').select('id, user_id, title, priority, created_at, user_profiles!support_tickets_user_id_fkey(full_name, department)').eq('status', 'open').order('created_at', { ascending: false }).limit(10),
      ]);

      const combined: PendingApproval[] = [];

      (leavesRes.data || []).forEach((l: any) => {
        const profile = l.user_profiles;
        combined.push({
          id: `leave-${l.id}`,
          rawId: l.id,
          type: 'leave',
          employee: profile?.full_name || 'Unknown',
          initials: getInitials(profile?.full_name || 'UN'),
          department: profile?.department || '',
          detail: `${l.leave_type} leave · ${l.total_days} day${l.total_days !== 1 ? 's' : ''} (${l.start_date} to ${l.end_date})`,
          urgency: 'medium',
          submittedAt: new Date(l.created_at).toLocaleDateString(),
        });
      });

      (expensesRes.data || []).forEach((e: any) => {
        const profile = e.user_profiles;
        combined.push({
          id: `expense-${e.id}`,
          rawId: e.id,
          type: 'expense',
          employee: profile?.full_name || 'Unknown',
          initials: getInitials(profile?.full_name || 'UN'),
          department: profile?.department || '',
          detail: e.title,
          amount: `${e.currency || 'INR'} ${Number(e.amount).toLocaleString()}`,
          urgency: 'normal',
          submittedAt: new Date(e.created_at).toLocaleDateString(),
        });
      });

      (ticketsRes.data || []).forEach((t: any) => {
        const profile = t.user_profiles;
        combined.push({
          id: `ticket-${t.id}`,
          rawId: t.id,
          type: 'complaint',
          employee: profile?.full_name || 'Unknown',
          initials: getInitials(profile?.full_name || 'UN'),
          department: profile?.department || '',
          detail: t.title,
          urgency: t.priority === 'urgent' || t.priority === 'high' ? 'high' : 'normal',
          submittedAt: new Date(t.created_at).toLocaleDateString(),
        });
      });

      setApprovals(combined);
    } catch (err) {
      console.error('Approvals fetch error:', err);
    }
  };

  const handleApprove = async (approval: PendingApproval) => {
    try {
      if (approval.type === 'leave') {
        await supabase.from('leave_requests').update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', approval.rawId);
      } else if (approval.type === 'expense') {
        await supabase.from('expenses').update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', approval.rawId);
      } else if (approval.type === 'complaint') {
        await supabase.from('support_tickets').update({ status: 'in_progress' }).eq('id', approval.rawId);
      }
      setApprovals((prev) => prev.filter((a) => a.id !== approval.id));
      toast.success(`Approved request from ${approval.employee}`, { duration: 2000 });
    } catch (err) {
      toast.error('Failed to approve request');
    }
  };

  const handleReject = async (approval: PendingApproval) => {
    try {
      if (approval.type === 'leave') {
        await supabase.from('leave_requests').update({ status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', approval.rawId);
      } else if (approval.type === 'expense') {
        await supabase.from('expenses').update({ status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq('id', approval.rawId);
      } else if (approval.type === 'complaint') {
        await supabase.from('support_tickets').update({ status: 'closed' }).eq('id', approval.rawId);
      }
      setApprovals((prev) => prev.filter((a) => a.id !== approval.id));
      toast.error(`Rejected request from ${approval.employee}`, { duration: 2000 });
    } catch (err) {
      toast.error('Failed to reject request');
    }
  };

  const handleAnnouncement = async () => {
    if (!announcement.trim() || !user?.id) return;
    setSendingAnnouncement(true);
    try {
      // Fetch all active employee IDs
      const { data: allUsers } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('is_active', true);

      if (allUsers && allUsers.length > 0) {
        const notifications = allUsers.map((u) => ({
          user_id: u.id,
          type: 'general',
          title: 'Company Announcement',
          message: announcement.trim(),
          is_read: false,
        }));
        const { error } = await supabase.from('notifications').insert(notifications);
        if (error) throw error;
      }

      toast.success('Announcement broadcast to all employees', { duration: 3000 });
      setAnnouncement('');
      setShowAnnounceForm(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send announcement');
    } finally {
      setSendingAnnouncement(false);
    }
  };

  const activeCount = employees.filter((e) => e.status === 'active').length;
  const lateCount = employees.filter((e) => e.status === 'late').length;
  const inactiveCount = employees.filter((e) => e.status === 'inactive').length;
  const onLeaveCount = employees.filter((e) => e.status === 'on-leave').length;

  const filteredEmployees = statusFilter === 'all' ? employees : employees.filter((e) => e.status === statusFilter);

  // Red flag counts
  const attendanceIssues = employees.filter((e) => e.status === 'inactive').length;
  const overdueTaskEmployees = employees.filter((e) => e.pendingTasks > 3).length;

  return (
    <>
      <Toaster position="bottom-right" richColors />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Crown size={16} className="text-amber-600" />
            </div>
            <h1 className="text-2xl font-700 text-slate-900 dark:text-slate-100">{t('directorControlPanel')}</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('completeCompanyOversight')} ·{' '}
            <span className="font-600 text-slate-700 dark:text-slate-300">{directorName}</span> ·{' '}
            {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={() => setShowAnnounceForm(!showAnnounceForm)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-600 px-4 py-2.5 rounded-xl transition-colors"
        >
          <Megaphone size={15} />
          {t('broadcastAnnouncement')}
        </button>
      </div>

      {/* Announcement Form */}
      {showAnnounceForm && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone size={15} className="text-amber-600" />
            <span className="text-sm font-600 text-amber-800 dark:text-amber-300">{t('companyWideAnnouncement')}</span>
          </div>
          <textarea
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder={t('announcementPlaceholder')}
            rows={3}
            className="w-full text-sm border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-amber-300 resize-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
          />
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleAnnouncement}
              disabled={!announcement.trim() || sendingAnnouncement}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-600 px-4 py-2 rounded-lg transition-colors"
            >
              <Bell size={13} />
              {sendingAnnouncement ? 'Sending…' : t('sendToAll')}
            </button>
            <button
              onClick={() => { setShowAnnounceForm(false); setAnnouncement(''); }}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-2"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* My Attendance Today */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <Clock size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">My attendance today</p>
            <p className="text-base font-600 text-slate-900 dark:text-slate-100">
              {myTodayLoading
                ? 'Loading…'
                : myToday
                  ? (MY_STATUS_LABELS[myToday.status] ?? myToday.status)
                  : 'Not clocked in'}
            </p>
          </div>
        </div>

        {!myTodayLoading && myToday && (
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Clock in</p>
              <p className="font-600 text-slate-800 dark:text-slate-200 tabular-nums">{fmtTime(myToday.clock_in)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Clock out</p>
              <p className="font-600 text-slate-800 dark:text-slate-200 tabular-nums">{fmtTime(myToday.clock_out)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500">Hours</p>
              <p className="font-600 text-slate-800 dark:text-slate-200 tabular-nums">
                {myToday.total_hours != null ? myToday.total_hours.toFixed(2) : '—'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: t('present'), value: activeCount, icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', trend: `${employees.length} total` },
          { label: t('late'), value: lateCount, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', trend: 'Today' },
          { label: t('inactive'), value: inactiveCount, icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', trend: 'Not clocked in' },
          { label: t('onLeave'), value: onLeaveCount, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', trend: 'Approved leave' },
        ].map((kpi) => {
          const KpiIcon = kpi.icon;
          return (
            <div key={`kpi-${kpi.label}`} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-4">
              <div className={`w-9 h-9 rounded-lg ${kpi.bg} flex items-center justify-center mb-3`}>
                <KpiIcon size={18} className={kpi.color} />
              </div>
              <p className="text-2xl font-700 text-slate-900 dark:text-slate-100 tabular-nums">{loading ? '…' : kpi.value}</p>
              <p className="text-sm font-500 text-slate-700 dark:text-slate-300 mt-0.5">{kpi.label}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{kpi.trend}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Live Employee Status */}
        <div className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">{t('liveEmployeeStatus')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{employees.length} {t('employee')} · {t('realTime')}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['all', 'active', 'late', 'inactive', 'on-leave'] as const).map((s) => (
                <button
                  key={`sf-${s}`}
                  onClick={() => setStatusFilter(s)}
                  className={`text-[11px] font-500 px-2.5 py-1 rounded-lg transition-all ${statusFilter === s ? 'bg-slate-800 dark:bg-slate-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                >
                  {s === 'all' ? t('all') : s === 'on-leave' ? t('onLeave') : s === 'active' ? t('present') : s === 'late' ? t('late') : t('inactive')}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-700 max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="py-10 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="py-10 text-center px-5">
                <Users size={28} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-500 text-slate-500 dark:text-slate-400">{t('noEmployeesToDisplay')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('employeeDataWillAppear')}</p>
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const sc = statusConfig[emp.status];
                return (
                  <div key={emp.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-700">
                        {emp.initials}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${sc.dot}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-600 text-slate-900 dark:text-slate-100">{emp.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{emp.designation} · {emp.department}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{emp.lastSeen}</p>
                        {emp.status !== 'on-leave' && emp.productivity > 0 && (
                          <div className="flex items-center gap-1 justify-end mt-0.5">
                            <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${emp.productivity >= 75 ? 'bg-emerald-500' : emp.productivity >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${emp.productivity}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{emp.productivity}%</span>
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${sc.badge}`}>{sc.label}</span>
                      {emp.pendingTasks > 0 && (
                        <span className="text-[10px] font-700 bg-red-100 dark:bg-red-900/30 text-red-600 px-1.5 py-0.5 rounded-full tabular-nums">
                          {emp.pendingTasks} {t('tasks')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Approvals */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">{t('quickApprovals')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{approvals.length} {t('pendingReview')}</p>
            </div>
            <span className="text-xs font-700 bg-amber-500 text-white px-2 py-0.5 rounded-full tabular-nums">
              {approvals.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700 max-h-[420px]">
            {approvals.length === 0 ? (
              <div className="py-10 text-center px-5">
                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-500 text-slate-500 dark:text-slate-400">{t('allCaughtUp')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('noPendingApprovals')}</p>
              </div>
            ) : (
              approvals.map((approval) => {
                const tc = approvalTypeConfig[approval.type];
                return (
                  <div key={approval.id} className="px-4 py-3.5">
                    <div className="flex items-start gap-2.5 mb-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-700 text-slate-700 dark:text-slate-300 flex-shrink-0">
                        {approval.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <p className="text-xs font-600 text-slate-900 dark:text-slate-100">{approval.employee}</p>
                          <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${tc.color}`}>{t(tc.labelKey as any)}</span>
                          <span className={`text-[10px] font-500 px-1.5 py-0.5 rounded-full ${urgencyConfig[approval.urgency]}`}>
                            {approval.urgency === 'high' ? t('high') : approval.urgency === 'medium' ? t('medium') : t('low')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{approval.department}</p>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">{approval.detail}</p>
                        {approval.amount && <p className="text-xs font-700 text-slate-900 dark:text-slate-100 mt-0.5">{approval.amount}</p>}
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{approval.submittedAt}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(approval)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs font-600 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 py-1.5 rounded-lg transition-colors"
                      >
                        <Check size={12} />{t('approved')}
                      </button>
                      <button
                        onClick={() => handleReject(approval)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs font-600 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 py-1.5 rounded-lg transition-colors"
                      >
                        <X size={12} />{t('rejected')}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Red Flag Summary */}
      <div className="mt-5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle size={14} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-base font-600 text-slate-900 dark:text-slate-100">{t('redFlagSummary')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('redFlagDesc')}</p>
            </div>
          </div>
          <Link href="/analytics-reporting-dashboard">
            <button className="text-xs text-blue-600 font-600 hover:underline flex items-center gap-1">
              {t('fullReport')} <ChevronRight size={12} />
            </button>
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { labelKey: 'attendanceIssues', count: attendanceIssues, color: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400', icon: Clock },
            { labelKey: 'lowProductivity', count: employees.filter((e) => e.productivity > 0 && e.productivity < 50).length, color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400', icon: TrendingDown },
            { labelKey: 'overdueTasks', count: overdueTaskEmployees, color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20', badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400', icon: AlertTriangle },
            { labelKey: 'turnoverRisk', count: employees.filter((e) => e.productivity < 30 && e.status === 'inactive').length, color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400', icon: TrendingDown },
          ].map((flag) => {
            const FlagIcon = flag.icon;
            return (
              <div key={`flag-${flag.labelKey}`} className={`rounded-xl border p-3.5 ${flag.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <FlagIcon size={14} className="text-slate-600 dark:text-slate-400" />
                  <span className={`text-xs font-700 px-2 py-0.5 rounded-full tabular-nums ${flag.badge}`}>{loading ? '…' : flag.count}</span>
                </div>
                <p className="text-sm font-600 text-slate-800 dark:text-slate-200">{t(flag.labelKey as any)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {flag.count === 0 ? t('noIssuesFlagged') : `${flag.count} employee${flag.count !== 1 ? 's' : ''} flagged`}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CalendarDays, Plus, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Search, Loader2, X, Upload, FileText, Eye, AlertCircle, ChevronLeft } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import Link from 'next/link';

type LeaveType = 'substitute' | 'paid' | 'medical' | 'half_day' | 'comp_off';
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string;
  is_half_day: boolean;
  half_day_period: string;
  doctor_certificate_url: string;
  doctor_certificate_path: string;
  created_at: string;
  user_profiles?: { full_name: string; department: string; job_title: string };
}

interface LeaveBalance {
  leave_type: LeaveType;
  total_days: number;
  used_days: number;
}

interface ApplyForm {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  is_half_day: boolean;
  half_day_type: 'first_half' | 'second_half' | 'full_day';
  certificate_file: File | null;
}

const leaveTypeConfig: Record<LeaveType, { label: string; color: string; bg: string; bar: string; quota: number; requiresCertificate: boolean; description: string }> = {
  substitute:  { label: 'Substitute Leave', color: 'text-blue-700',    bg: 'bg-blue-50',    bar: 'bg-blue-500',   quota: 12, requiresCertificate: false, description: 'Substitute / compensatory leave — must be applied for' },
  paid:        { label: 'Paid Leave',        color: 'text-emerald-700', bg: 'bg-emerald-50', bar: 'bg-emerald-500',quota: 5,  requiresCertificate: false, description: '5 paid leaves per financial year — must be applied for' },
  medical:     { label: 'Medical Leave',     color: 'text-red-700',     bg: 'bg-red-50',     bar: 'bg-red-400',    quota: 8,  requiresCertificate: true,  description: 'Medical leave — doctor certificate required — must be applied for' },
  half_day:    { label: 'Half Day Leave',    color: 'text-amber-700',   bg: 'bg-amber-50',   bar: 'bg-amber-400',  quota: 10, requiresCertificate: false, description: 'Half day leave — deducts 0.5 day from balance' },
  comp_off:    { label: 'Comp-Off',          color: 'text-purple-700',  bg: 'bg-purple-50',  bar: 'bg-purple-500', quota: 0,  requiresCertificate: false, description: 'Compensatory off for working on holidays/weekends' },
};

const statusConfig: Record<LeaveStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: 'Pending',   color: 'text-amber-600 bg-amber-50 border-amber-200',   icon: Clock        },
  approved:  { label: 'Approved',  color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  rejected:  { label: 'Rejected',  color: 'text-red-600 bg-red-50 border-red-200',         icon: XCircle      },
  cancelled: { label: 'Cancelled', color: 'text-slate-500 bg-slate-50 border-slate-200',   icon: X            },
};

const defaultForm: ApplyForm = {
  leave_type: 'substitute',
  start_date: '',
  end_date: '',
  reason: '',
  is_half_day: false,
  half_day_type: 'full_day',
  certificate_file: null,
};

function getFiscalYear(date: Date = new Date()): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

function calcDays(start: string, end: string, isHalfDay?: boolean): number {
  if (!start || !end) return 0;
  if (isHalfDay) return 0.5;
  const s = new Date(start);
  const e = new Date(end);
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LeaveManagement() {
  const { user, effectiveUserId, pinSession } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<any>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [form, setForm] = useState<ApplyForm>(defaultForm);
  const [filterStatus, setFilterStatus] = useState<'all' | LeaveStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: string; reason: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'my-leaves' | 'team-leaves'>('my-leaves');
  const [uploadingCert, setUploadingCert] = useState(false);
  const [currentFY, setCurrentFY] = useState<number>(getFiscalYear());

  const isManager = profile?.role === 'manager' || profile?.role === 'director'
    || pinSession?.role === 'manager' || pinSession?.role === 'director' || pinSession?.role === 'executive';

  const fetchProfile = useCallback(async () => {
    const uid = effectiveUserId;
    if (!uid) return;
    const { data } = await supabase.from('user_profiles').select('*').eq('id', uid).single();
    setProfile(data);
  }, [effectiveUserId]);

  const fetchBalances = useCallback(async () => {
    const uid = effectiveUserId;
    if (!uid) return;
    const fy = getFiscalYear();
    setCurrentFY(fy);

    const { data: settingsData } = await supabase
      .from('director_settings')
      .select('setting_value')
      .eq('setting_key', 'leave_quotas_by_fy')
      .single();

    const fyKey = `${fy}-${fy + 1}`;
    const adminQuotas = settingsData?.setting_value?.[fyKey] || settingsData?.setting_value?.[String(fy)];

    // Determine user role for quota lookup
    const userRole = profile?.role || pinSession?.role || 'employee';
    const roleKey = userRole.toLowerCase();

    const resolvedQuota = (lt: LeaveType): number => {
      // First try role-specific quota from firm config
      if (adminQuotas) {
        const roleQuota = adminQuotas[roleKey] || adminQuotas['employee'];
        if (roleQuota && roleQuota[lt] !== undefined) return roleQuota[lt];
        // Fallback: try flat quota (old format)
        if (adminQuotas[lt] !== undefined) return adminQuotas[lt];
      }
      return leaveTypeConfig[lt].quota;
    };

    const { data } = await supabase
      .from('leave_balances')
      .select('leave_type, total_days, used_days')
      .eq('user_id', uid)
      .eq('fiscal_year', fy)
      .in('leave_type', ['substitute', 'paid', 'medical', 'half_day', 'comp_off']);

    const leaveTypes: LeaveType[] = ['substitute', 'paid', 'medical', 'half_day'];

    const upsertRows = leaveTypes.map(lt => {
      const existing = (data || []).find((b: any) => b.leave_type === lt);
      return {
        user_id: uid,
        leave_type: lt,
        fiscal_year: fy,
        total_days: resolvedQuota(lt),
        used_days: existing?.used_days ?? 0,
        carry_forward_days: 0,
      };
    });

    await supabase.from('leave_balances').upsert(upsertRows, {
      onConflict: 'user_id,leave_type,fiscal_year',
      ignoreDuplicates: false,
    });

    const { data: finalData } = await supabase
      .from('leave_balances')
      .select('leave_type, total_days, used_days')
      .eq('user_id', uid)
      .eq('fiscal_year', fy)
      .in('leave_type', ['substitute', 'paid', 'medical', 'half_day', 'comp_off']);

    setBalances((finalData || []) as LeaveBalance[]);
  }, [effectiveUserId, profile, pinSession]);

  const fetchRequests = useCallback(async () => {
    const uid = effectiveUserId;
    if (!uid) return;
    setLoading(true);
    try {
      if (activeTab === 'my-leaves') {
        const { data, error } = await supabase
          .from('leave_requests')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setRequests(data || []);
      } else {
        const { data, error } = await supabase
          .from('leave_requests')
          .select('*, user_profiles!leave_requests_user_id_fkey(full_name, department, job_title)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setRequests(data || []);
      }
    } catch (err: any) {
      toast.error('Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, activeTab]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const uid = effectiveUserId;
    if (!uid) return;
    const channel = supabase
      .channel('leave-requests-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        fetchRequests();
        fetchBalances();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [effectiveUserId, fetchRequests, fetchBalances]);

  const getBalance = (lt: LeaveType) => {
    const b = balances.find((x) => x.leave_type === lt);
    const cfg = leaveTypeConfig[lt];
    return { total: b?.total_days ?? cfg.quota, used: b?.used_days ?? 0 };
  };

  const uploadCertificate = async (file: File): Promise<{ path: string; url: string } | null> => {
    const uid = effectiveUserId;
    if (!uid) return null;
    setUploadingCert(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `${uid}/leave-cert-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('leave-certificates')
        .upload(filePath, file, { upsert: false });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('leave-certificates').getPublicUrl(filePath);
      return { path: filePath, url: urlData?.publicUrl || '' };
    } catch (err: any) {
      toast.error('Failed to upload certificate: ' + (err.message || 'Unknown error'));
      return null;
    } finally {
      setUploadingCert(false);
    }
  };

  const handleApply = async () => {
    const uid = effectiveUserId;
    if (!uid) { toast.error('You must be logged in to apply for leave'); return; }
    if (!form.start_date || !form.end_date) { toast.error('Please select start and end dates'); return; }
    if (!form.reason.trim()) { toast.error('Please provide a reason'); return; }
    const isHalf = form.leave_type === 'half_day' || form.is_half_day;
    const days = calcDays(form.start_date, form.end_date, isHalf);
    if (days <= 0) { toast.error('Invalid date range'); return; }

    const cfg = leaveTypeConfig[form.leave_type];
    if (cfg.requiresCertificate && !form.certificate_file) {
      toast.error(`A doctor's certificate is required for ${cfg.label}`);
      return;
    }

    setSubmitting(true);
    try {
      let certPath = '';
      let certUrl = '';
      if (form.certificate_file) {
        const uploaded = await uploadCertificate(form.certificate_file);
        if (!uploaded && cfg.requiresCertificate) {
          setSubmitting(false);
          return;
        }
        certPath = uploaded?.path || '';
        certUrl = uploaded?.url || '';
      }

      const { error } = await supabase.from('leave_requests').insert({
        user_id: uid,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        total_days: days,
        reason: form.reason,
        status: 'pending',
        is_half_day: isHalf,
        half_day_period: isHalf ? (form.half_day_type === 'first_half' ? 'morning' : 'afternoon') : '',
        half_day_type: isHalf ? form.half_day_type : 'full_day',
        doctor_certificate_url: certUrl,
        doctor_certificate_path: certPath,
      });
      if (error) throw error;
      toast.success('Leave request submitted successfully');
      setShowApplyForm(false);
      setForm(defaultForm);
      fetchRequests();
      fetchBalances();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit leave request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    const uid = effectiveUserId;
    if (!uid) return;
    try {
      const { error } = await supabase.from('leave_requests').update({
        status: 'approved',
        reviewed_by: uid,
        reviewed_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      toast.success('Leave request approved');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve');
    }
  };

  const handleReject = async () => {
    const uid = effectiveUserId;
    if (!rejectModal || !uid) return;
    if (!rejectModal.reason.trim()) { toast.error('Please provide a rejection reason'); return; }
    try {
      const { error } = await supabase.from('leave_requests').update({
        status: 'rejected',
        reviewed_by: uid,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectModal.reason,
      }).eq('id', rejectModal.id);
      if (error) throw error;
      toast.success('Leave request rejected');
      setRejectModal(null);
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject');
    }
  };

  const handleCancel = async (id: string) => {
    const uid = effectiveUserId;
    if (!uid) return;
    try {
      const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      toast.success('Leave request cancelled');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel');
    }
  };

  const filteredRequests = requests.filter((r) => {
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    const name = r.user_profiles?.full_name || '';
    const matchSearch = !searchQuery || r.reason.toLowerCase().includes(searchQuery.toLowerCase()) || name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const fyLabel = `FY ${currentFY}-${String(currentFY + 1).slice(2)}`;
  const selectedCfg = leaveTypeConfig[form.leave_type];
  const selectedBal = getBalance(form.leave_type);
  const requestedDays = calcDays(form.start_date, form.end_date);

  const isMyRequest = (req: LeaveRequest) => req.user_id === effectiveUserId;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/employee-dashboard" className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
            <ChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Leave Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5">Apply, track and manage leave · <span className="font-semibold text-blue-600">{fyLabel}</span></p>
          </div>
        </div>
        <button
          onClick={() => setShowApplyForm(!showApplyForm)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus size={16} />
          {showApplyForm ? 'Hide Form' : 'Apply for Leave'}
        </button>
      </div>

      {/* Leave Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {(Object.keys(leaveTypeConfig) as LeaveType[]).map((lt) => {
          const cfg = leaveTypeConfig[lt];
          const { total, used } = getBalance(lt);
          const remaining = total - used;
          const pct = total > 0 ? (used / total) * 100 : 0;
          const isLow = remaining <= 1 && total > 0;
          return (
            <div key={lt} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 mb-1 truncate">{cfg.label}</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className={`text-2xl font-bold tabular-nums ${isLow ? 'text-red-600' : cfg.color}`}>{remaining}</span>
                <span className="text-xs text-slate-400">/ {total}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${cfg.bar} ${isLow ? 'animate-pulse' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              {isLow && <p className="text-[10px] text-red-500 font-semibold mt-1">Low balance</p>}
              <p className="text-[10px] text-slate-400 mt-1">{cfg.description}</p>
            </div>
          );
        })}
      </div>

      {/* Apply Form (inline, collapsible) */}
      {showApplyForm && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-blue-50 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Apply for Leave</h2>
            <button onClick={() => setShowApplyForm(false)} className="p-2 rounded-xl hover:bg-slate-200 transition-colors">
              <X size={16} className="text-slate-500" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {/* Leave Type */}
            <div>
              <label className="block text-sm font-600 text-slate-700 mb-1.5">Leave Type</label>
              <select
                value={form.leave_type}
                onChange={(e) => setForm({ ...form, leave_type: e.target.value as LeaveType, certificate_file: null })}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              >
                {(Object.keys(leaveTypeConfig) as LeaveType[]).map((lt) => (
                  <option key={lt} value={lt}>{leaveTypeConfig[lt].label}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">{selectedCfg.description}</p>
              {selectedCfg.requiresCertificate && (
                <p className="mt-1 text-xs text-purple-600 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  Doctor certificate required for {selectedCfg.label}
                </p>
              )}
            </div>

            {/* Half-Day Option */}
            {(form.leave_type === 'half_day' || form.leave_type === 'substitute' || form.leave_type === 'paid') && (
              <div>
                <label className="block text-sm font-600 text-slate-700 mb-2">Leave Duration</label>
                <div className="flex gap-2">
                  {[
                    { value: 'full_day', label: 'Full Day' },
                    { value: 'first_half', label: 'First Half (Morning)' },
                    { value: 'second_half', label: 'Second Half (Afternoon)' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        half_day_type: opt.value as 'full_day' | 'first_half' | 'second_half',
                        is_half_day: opt.value !== 'full_day',
                      }))}
                      className={`flex-1 py-2 px-2 text-xs font-semibold rounded-lg border transition-colors ${
                        form.half_day_type === opt.value
                          ? 'bg-amber-600 text-white border-amber-600' :'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.is_half_day && (
                  <p className="text-xs text-amber-600 mt-1.5 font-semibold">
                    ½ day leave — deducts 0.5 day from your balance
                  </p>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  min={form.start_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Reason <span className="text-red-500">*</span></label>
              <textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="Briefly describe the reason for your leave..."
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
              />
            </div>

            {/* Certificate upload for medical */}
            {selectedCfg.requiresCertificate && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Doctor Certificate <span className="text-red-500">* Required</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-300 transition-colors"
                >
                  {form.certificate_file ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
                      <FileText size={16} />
                      <span>{form.certificate_file.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); setForm({ ...form, certificate_file: null }); }} className="text-red-500 hover:text-red-700">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="text-slate-400">
                      <Upload size={20} className="mx-auto mb-1" />
                      <p className="text-xs">Click to upload certificate (PDF, JPG, PNG — max 10MB)</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (file && file.size > 10 * 1024 * 1024) { toast.error('File size must be under 10MB'); return; }
                    setForm({ ...form, certificate_file: file });
                  }}
                />
              </div>
            )}

            {/* Summary */}
            {form.start_date && form.end_date && (
              <div className="bg-slate-50 rounded-xl p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Duration:</span>
                  <span className="font-600 text-slate-900">{requestedDays} day{requestedDays !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-600">Balance after:</span>
                  <span className={`font-600 ${selectedBal.total - selectedBal.used - requestedDays < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {selectedBal.total - selectedBal.used - requestedDays} days
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowApplyForm(false); setForm(defaultForm); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-600 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={submitting || uploadingCert}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {(submitting || uploadingCert) ? <Loader2 size={16} className="animate-spin" /> : null}
                {submitting ? 'Submitting…' : uploadingCert ? 'Uploading…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs (manager/director only) */}
      {isManager && (
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4 w-fit">
          <button
            onClick={() => setActiveTab('my-leaves')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === 'my-leaves' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            My Leaves
          </button>
          <button
            onClick={() => setActiveTab('team-leaves')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${activeTab === 'team-leaves' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Team Leaves
            {pendingCount > 0 && activeTab !== 'team-leaves' && (
              <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{pendingCount}</span>
            )}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by reason or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors capitalize ${
                filterStatus === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-slate-400" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-16 text-slate-400">
          <CalendarDays size={32} className="mb-3 opacity-50" />
          <p className="text-sm font-500">No leave requests found</p>
          <p className="text-xs mt-1">Click &quot;Apply for Leave&quot; to submit your first request</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const leaveType = (req.leave_type as string) in leaveTypeConfig ? req.leave_type as LeaveType : 'paid';
            const cfg = leaveTypeConfig[leaveType] || leaveTypeConfig.paid;
            const sc = statusConfig[req.status];
            const StatusIcon = sc.icon;
            const isExpanded = expandedId === req.id;

            return (
              <div key={req.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                >
                  <div className={`w-10 h-10 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    <CalendarDays size={18} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900">{cfg.label}</p>
                      {req.user_profiles && (
                        <span className="text-xs text-slate-500">· {req.user_profiles.full_name}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatDate(req.start_date)} – {formatDate(req.end_date)} · {req.total_days} day{req.total_days !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`inline-flex items-center gap-1 text-xs font-600 px-2.5 py-1 rounded-full border ${sc.color}`}>
                      <StatusIcon size={11} />
                      {sc.label}
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
                    <div>
                      <p className="text-xs font-600 text-slate-500 mb-1">Reason</p>
                      <p className="text-sm text-slate-700">{req.reason || '—'}</p>
                    </div>
                    {req.rejection_reason && (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                        <p className="text-xs font-600 text-red-600 mb-1">Rejection Reason</p>
                        <p className="text-sm text-red-700">{req.rejection_reason}</p>
                      </div>
                    )}
                    {req.doctor_certificate_url && (
                      <a href={req.doctor_certificate_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                        <Eye size={13} /> View Certificate
                      </a>
                    )}
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {isManager && req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApprove(req.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-600 rounded-lg transition-colors"
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                          <button
                            onClick={() => setRejectModal({ id: req.id, reason: '' })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-600 rounded-lg transition-colors"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        </>
                      )}
                      {isMyRequest(req) && req.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(req.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-600 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <X size={13} /> Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-700 text-slate-900 mb-4">Reject Leave Request</h3>
            <textarea
              value={rejectModal.reason}
              onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
              placeholder="Provide a reason for rejection..."
              rows={3}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-600 text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleReject} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-600 transition-colors">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

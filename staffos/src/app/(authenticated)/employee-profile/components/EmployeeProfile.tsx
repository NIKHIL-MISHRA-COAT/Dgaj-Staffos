'use client';

import React, { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, MapPin, Briefcase, Calendar, FileText, Upload, CheckCircle2, Clock, XCircle, Edit3, Save, X, Camera, Heart, Globe, Users, Award, Plus, TrendingUp, Palmtree, BarChart2, Download, CreditCard, ChevronDown, ChevronUp, AlertCircle, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';




interface ProfileData {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  job_title: string;
  employee_id: string;
  date_of_birth: string;
  date_of_joining: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  blood_group: string;
  nationality: string;
  profile_photo_url: string;
  bio: string;
  skills: string[];
  approval_status: string;
}

interface DocumentRecord {
  id: string;
  document_name: string;
  document_type: string;
  file_url: string;
  file_size: number;
  doc_status: string;
  uploaded_at: string;
}

interface LeaveBalance {
  leave_type: string;
  total_allocated: number;
  used: number;
  pending: number;
  remaining: number;
}

interface AttendanceStat {
  present: number;
  absent: number;
  late: number;
  half_day: number;
  work_from_home: number;
  total_hours: number;
  avg_hours: number;
  working_days: number;
}

interface PayslipRecord {
  id: string;
  month: string;
  year: number;
  gross_salary: number;
  net_salary: number;
  deductions: number;
  status: string;
  generated_at: string;
}

const DOCUMENT_TYPES = [
  'National ID / Aadhaar', 'Passport', 'PAN Card', 'Driving License',
  'Educational Certificate', 'Experience Letter', 'Offer Letter',
  'Bank Details', 'Address Proof', 'Other',
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const LEAVE_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  substitute: { label: 'Substitute Leave', color: 'text-blue-700', bg: 'bg-blue-50' },
  paid:       { label: 'Paid Leave',        color: 'text-emerald-700', bg: 'bg-emerald-50' },
  unpaid:     { label: 'Unpaid Leave',      color: 'text-slate-700', bg: 'bg-slate-100' },
  medical:    { label: 'Medical Leave',     color: 'text-red-700', bg: 'bg-red-50' },
  half_day:   { label: 'Half Day',          color: 'text-amber-700', bg: 'bg-amber-50' },
  // legacy fallbacks
  casual:     { label: 'Casual Leave',      color: 'text-blue-700', bg: 'bg-blue-50' },
  sick:       { label: 'Sick Leave',        color: 'text-red-700', bg: 'bg-red-50' },
};

const docStatusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Under Review', color: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700', icon: XCircle },
};

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Payroll integration not yet configured — no mock data
const MOCK_PAYSLIPS: PayslipRecord[] = [];

type TabType = 'overview' | 'personal' | 'payslips' | 'documents' | 'skills';

export default function EmployeeProfile() {
  const { user, pinSession, effectiveUserId, getUserProfile, updateUserProfile, uploadDocument, getDocuments } = useAuth();
  const supabase = createClient();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [attendanceStat, setAttendanceStat] = useState<AttendanceStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<Partial<ProfileData>>({});
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [uploading, setUploading] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [uploadDocType, setUploadDocType] = useState(DOCUMENT_TYPES[0]);
  const [uploadDocName, setUploadDocName] = useState('');
  const [expandedPayslip, setExpandedPayslip] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [user, pinSession]);

  const loadData = async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const [profileData, docsData] = await Promise.all([
        getUserProfile(),
        getDocuments(),
      ]);
      setProfile(profileData);
      setDocuments(docsData || []);
      await loadLeaveBalances(profileData);
      await loadAttendanceStats();
    } catch {
      toast.error('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const loadLeaveBalances = async (profileData: ProfileData | null) => {
    if (!effectiveUserId) return;
    try {
      // Get leave requests for current FY
      const fyStart = '2026-04-01';
      const fyEnd = '2027-03-31';
      const { data: leaveRequests } = await supabase
        .from('leave_requests')
        .select('leave_type, status, start_date, end_date, total_days')
        .eq('user_id', effectiveUserId)
        .gte('start_date', fyStart)
        .lte('start_date', fyEnd);

      // Get leave quotas from director_settings
      const { data: settingsData } = await supabase
        .from('director_settings')
        .select('setting_value')
        .eq('setting_key', 'leave_quotas_by_fy')
        .single();

      const role = profileData?.role || 'employee';
      const quotas = settingsData?.setting_value?.[role] || {
        casual: 12, sick: 8, paid: 15, comp_off: 2, work_from_home: 8,
      };

      const balances: LeaveBalance[] = Object.entries(quotas).map(([type, total]) => {
        const approved = (leaveRequests || [])
          .filter((r: any) => r.leave_type === type && r.status === 'approved')
          .reduce((sum: number, r: any) => sum + (r.total_days || 0), 0);
        const pending = (leaveRequests || [])
          .filter((r: any) => r.leave_type === type && r.status === 'pending')
          .reduce((sum: number, r: any) => sum + (r.total_days || 0), 0);
        return {
          leave_type: type,
          total_allocated: total as number,
          used: approved,
          pending,
          remaining: Math.max(0, (total as number) - approved),
        };
      });

      setLeaveBalances(balances);
    } catch {
      // silently fail — leave balance is supplementary
    }
  };

  const loadAttendanceStats = async () => {
    if (!effectiveUserId) return;
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const { data: records } = await supabase
        .from('attendance_records')
        .select('status, total_hours, work_date')
        .eq('user_id', effectiveUserId)
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd);

      if (!records || records.length === 0) {
        setAttendanceStat(null);
        return;
      }

      const stat: AttendanceStat = {
        present: records.filter((r: any) => r.status === 'present').length,
        absent: records.filter((r: any) => r.status === 'absent').length,
        late: records.filter((r: any) => r.status === 'late').length,
        half_day: records.filter((r: any) => r.status === 'half_day').length,
        work_from_home: records.filter((r: any) => r.status === 'work_from_home').length,
        total_hours: records.reduce((s: number, r: any) => s + (r.total_hours || 0), 0),
        avg_hours: 0,
        working_days: records.length,
      };
      stat.avg_hours = stat.working_days > 0 ? stat.total_hours / stat.working_days : 0;
      setAttendanceStat(stat);
    } catch {
      // silently fail
    }
  };

  const handleEdit = () => {
    if (!profile) return;
    setEditData({ ...profile });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      const updated = await updateUserProfile(editData);
      setProfile(updated);
      setEditing(false);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveUserId) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Photo must be under 5MB'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${effectiveUserId}/profile_photo.${ext}`;
      const { error } = await supabase.storage.from('employee-documents').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('employee-documents').getPublicUrl(path);
      await updateUserProfile({ profile_photo_url: publicUrl });
      setProfile((p) => p ? { ...p, profile_photo_url: publicUrl } : p);
      toast.success('Profile photo updated');
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadDocName.trim()) { toast.error('Please enter a document name'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File must be under 10MB'); return; }
    setUploading(true);
    try {
      await uploadDocument(file, uploadDocName.trim(), uploadDocType);
      await loadData();
      setUploadDocName('');
      toast.success('Document uploaded successfully');
    } catch {
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddSkill = () => {
    if (!newSkill.trim()) return;
    const skills = [...(editData.skills || profile?.skills || []), newSkill.trim()];
    setEditData((d) => ({ ...d, skills }));
    setNewSkill('');
  };

  const handleRemoveSkill = (idx: number) => {
    const skills = [...(editData.skills || profile?.skills || [])];
    skills.splice(idx, 1);
    setEditData((d) => ({ ...d, skills }));
  };

  const roleColors: Record<string, string> = {
    director: 'bg-amber-100 text-amber-700',
    manager: 'bg-purple-100 text-purple-700',
    employee: 'bg-blue-100 text-blue-700',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const initials = (profile?.full_name || 'U').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'personal', label: 'Personal' },
    { id: 'payslips', label: 'Payslips' },
    { id: 'documents', label: 'Documents' },
    { id: 'skills', label: 'Skills' },
  ];

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">

        {/* Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-5">
          <div className="h-24 bg-gradient-to-r from-slate-900 via-blue-900 to-blue-700 relative">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          </div>
          <div className="px-5 sm:px-6 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10 mb-4">
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-2xl border-4 border-white shadow-md overflow-hidden bg-blue-700 flex items-center justify-center">
                  {profile?.profile_photo_url ? (
                    <img src={profile.profile_photo_url} alt={profile.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-2xl font-bold">{initials}</span>
                  )}
                </div>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow transition-colors"
                >
                  <Camera size={13} />
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              </div>
              <div className="flex-1 min-w-0 mt-2 sm:mt-0 sm:pb-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h1 className="text-xl font-bold text-slate-900 leading-tight">{profile?.full_name || 'Your Name'}</h1>
                  {profile?.role && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${roleColors[profile.role] || 'bg-slate-100 text-slate-600'}`}>
                      {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                    </span>
                  )}
                  {profile?.approval_status === 'pending' && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">Pending Approval</span>
                  )}
                </div>
                <p className="text-sm text-slate-500 truncate">{profile?.job_title || '—'} · {profile?.department || '—'}</p>
                {profile?.employee_id && <p className="text-xs text-slate-400 mt-0.5">ID: {profile.employee_id}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {editing ? (
                  <>
                    <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">
                      <X size={14} /> Cancel
                    </button>
                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-60">
                      <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button onClick={handleEdit} className="flex items-center gap-1.5 text-sm bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl transition-colors">
                    <Edit3 size={14} /> Edit Profile
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-100 -mx-1 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-5">

            {/* Leave Balance Overview */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Palmtree size={14} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Leave Balance — FY 2026–27</h3>
                  <p className="text-xs text-slate-500">Your leave quota and usage for the current financial year</p>
                </div>
              </div>
              {leaveBalances.length === 0 ? (
                <div className="py-10 text-center px-5">
                  <Palmtree size={28} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No leave data available</p>
                </div>
              ) : (
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {leaveBalances.map((lb) => {
                    const cfg = LEAVE_TYPE_CONFIG[lb.leave_type] || { label: lb.leave_type, color: 'text-slate-700', bg: 'bg-slate-100' };
                    const pct = lb.total_allocated > 0 ? Math.min(100, (lb.used / lb.total_allocated) * 100) : 0;
                    return (
                      <div key={lb.leave_type} className={`rounded-xl p-4 ${cfg.bg} border border-white`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                          <span className={`text-xs font-semibold ${cfg.color}`}>{lb.remaining}/{lb.total_allocated} left</span>
                        </div>
                        <div className="w-full bg-white/60 rounded-full h-1.5 mb-2">
                          <div
                            className={`h-1.5 rounded-full transition-all ${pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>{lb.used} used</span>
                          {lb.pending > 0 && <span className="text-amber-600">{lb.pending} pending</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Attendance Stats */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <BarChart2 size={14} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Attendance — This Month</h3>
                  <p className="text-xs text-slate-500">Your attendance summary for the current month</p>
                </div>
              </div>
              {!attendanceStat ? (
                <div className="py-10 text-center px-5">
                  <BarChart2 size={28} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No attendance records for this month</p>
                  <p className="text-xs text-slate-400 mt-1">Records will appear once attendance is logged</p>
                </div>
              ) : (
                <div className="p-5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                    {[
                      { label: 'Present', value: attendanceStat.present, color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
                      { label: 'Absent', value: attendanceStat.absent, color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
                      { label: 'Late', value: attendanceStat.late, color: 'text-amber-700', bg: 'bg-amber-50', icon: AlertCircle },
                      { label: 'Half Day', value: attendanceStat.half_day, color: 'text-orange-700', bg: 'bg-orange-50', icon: Minus },
                      { label: 'WFH', value: attendanceStat.work_from_home, color: 'text-blue-700', bg: 'bg-blue-50', icon: TrendingUp },
                      { label: 'Avg Hours', value: `${attendanceStat.avg_hours.toFixed(1)}h`, color: 'text-purple-700', bg: 'bg-purple-50', icon: Clock },
                    ].map(({ label, value, color, bg, icon: IconComponent }) => (
                      <div key={label} className={`rounded-xl p-3 ${bg} text-center`}>
                        {React.createElement(IconComponent, { size: 16, className: `${color} mx-auto mb-1` })}
                        <p className={`text-lg font-bold ${color}`}>{value}</p>
                        <p className="text-[11px] text-slate-500 font-medium">{label}</p>
                      </div>
                    ))}
                  </div>
                  {/* Attendance bar */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                      <span>Attendance Rate</span>
                      <span className="font-semibold text-slate-700">
                        {attendanceStat.working_days > 0
                          ? `${Math.round(((attendanceStat.present + attendanceStat.work_from_home + attendanceStat.half_day * 0.5) / attendanceStat.working_days) * 100)}%`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                      {attendanceStat.present > 0 && (
                        <div className="bg-emerald-500 rounded-l-full" style={{ flex: attendanceStat.present }} title={`Present: ${attendanceStat.present}`} />
                      )}
                      {attendanceStat.work_from_home > 0 && (
                        <div className="bg-blue-400" style={{ flex: attendanceStat.work_from_home }} title={`WFH: ${attendanceStat.work_from_home}`} />
                      )}
                      {attendanceStat.late > 0 && (
                        <div className="bg-amber-400" style={{ flex: attendanceStat.late }} title={`Late: ${attendanceStat.late}`} />
                      )}
                      {attendanceStat.half_day > 0 && (
                        <div className="bg-orange-400" style={{ flex: attendanceStat.half_day }} title={`Half Day: ${attendanceStat.half_day}`} />
                      )}
                      {attendanceStat.absent > 0 && (
                        <div className="bg-red-400 rounded-r-full" style={{ flex: attendanceStat.absent }} title={`Absent: ${attendanceStat.absent}`} />
                      )}
                    </div>
                    <div className="flex gap-4 mt-2 flex-wrap">
                      {[
                        { label: 'Present', color: 'bg-emerald-500' },
                        { label: 'WFH', color: 'bg-blue-400' },
                        { label: 'Late', color: 'bg-amber-400' },
                        { label: 'Half Day', color: 'bg-orange-400' },
                        { label: 'Absent', color: 'bg-red-400' },
                      ].map(({ label, color }) => (
                        <div key={label} className="flex items-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                          <span className="text-[11px] text-slate-500">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <FileText size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{documents.length}</p>
                  <p className="text-xs text-slate-500">Documents on file</p>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Award size={18} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{profile?.skills?.length || 0}</p>
                  <p className="text-xs text-slate-500">Skills listed</p>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <Calendar size={18} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {profile?.date_of_joining
                      ? `${Math.floor((Date.now() - new Date(profile.date_of_joining).getTime()) / (1000 * 60 * 60 * 24 * 365))}y`
                      : '—'}
                  </p>
                  <p className="text-xs text-slate-500">Tenure</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PERSONAL TAB ── */}
        {activeTab === 'personal' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Basic Info */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><User size={14} className="text-blue-600" /></div>
                <h3 className="text-sm font-bold text-slate-800">Basic Information</h3>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Full Name', key: 'full_name', icon: User },
                  { label: 'Email', key: 'email', icon: Mail, disabled: true },
                  { label: 'Phone', key: 'phone', icon: Phone },
                  { label: 'Employee ID', key: 'employee_id', icon: Briefcase },
                  { label: 'Nationality', key: 'nationality', icon: Globe },
                ].map(({ label, key, icon: FieldIcon, disabled }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
                      {React.createElement(FieldIcon, { size: 11 })} {label}
                    </label>
                    {editing && !disabled ? (
                      <input
                        value={(editData as any)[key] || ''}
                        onChange={(e) => setEditData((d) => ({ ...d, [key]: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800"
                      />
                    ) : (
                      <p className="text-sm text-slate-800">{(profile as any)?.[key] || <span className="text-slate-400">Not set</span>}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Work Info */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center"><Briefcase size={14} className="text-purple-600" /></div>
                <h3 className="text-sm font-bold text-slate-800">Work Details</h3>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Department', key: 'department' },
                  { label: 'Job Title', key: 'job_title' },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-slate-500 mb-1 block">{label}</label>
                    {editing ? (
                      <input
                        value={(editData as any)[key] || ''}
                        onChange={(e) => setEditData((d) => ({ ...d, [key]: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800"
                      />
                    ) : (
                      <p className="text-sm text-slate-800">{(profile as any)?.[key] || <span className="text-slate-400">Not set</span>}</p>
                    )}
                  </div>
                ))}
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><Calendar size={11} /> Date of Joining</label>
                  {editing ? (
                    <input type="date" value={editData.date_of_joining || ''} onChange={(e) => setEditData((d) => ({ ...d, date_of_joining: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                  ) : (
                    <p className="text-sm text-slate-800">{profile?.date_of_joining ? new Date(profile.date_of_joining).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Bio</label>
                  {editing ? (
                    <textarea value={editData.bio || ''} onChange={(e) => setEditData((d) => ({ ...d, bio: e.target.value }))} rows={3}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 resize-none" />
                  ) : (
                    <p className="text-sm text-slate-800 leading-relaxed">{profile?.bio || <span className="text-slate-400">No bio added</span>}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Personal Details */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><Heart size={14} className="text-emerald-600" /></div>
                <h3 className="text-sm font-bold text-slate-800">Personal Details</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><Calendar size={11} /> Date of Birth</label>
                  {editing ? (
                    <input type="date" value={editData.date_of_birth || ''} onChange={(e) => setEditData((d) => ({ ...d, date_of_birth: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                  ) : (
                    <p className="text-sm text-slate-800">{profile?.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Blood Group</label>
                  {editing ? (
                    <select value={editData.blood_group || ''} onChange={(e) => setEditData((d) => ({ ...d, blood_group: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 bg-white">
                      <option value="">Select</option>
                      {BLOOD_GROUPS.map((bg) => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  ) : (
                    <p className="text-sm text-slate-800">{profile?.blood_group || <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><MapPin size={11} /> Address</label>
                  {editing ? (
                    <textarea value={editData.address || ''} onChange={(e) => setEditData((d) => ({ ...d, address: e.target.value }))} rows={2}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 resize-none" />
                  ) : (
                    <p className="text-sm text-slate-800 leading-relaxed">{profile?.address || <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><Users size={14} className="text-red-500" /></div>
                <h3 className="text-sm font-bold text-slate-800">Emergency Contact</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Contact Name</label>
                  {editing ? (
                    <input value={editData.emergency_contact_name || ''} onChange={(e) => setEditData((d) => ({ ...d, emergency_contact_name: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                  ) : (
                    <p className="text-sm text-slate-800">{profile?.emergency_contact_name || <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Contact Phone</label>
                  {editing ? (
                    <input value={editData.emergency_contact_phone || ''} onChange={(e) => setEditData((d) => ({ ...d, emergency_contact_phone: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                  ) : (
                    <p className="text-sm text-slate-800">{profile?.emergency_contact_phone || <span className="text-slate-400">Not set</span>}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PAYSLIPS TAB ── */}
        {activeTab === 'payslips' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">Payroll integration is not yet configured. Contact your Director to set up the payroll system.</p>
            </div>

            {MOCK_PAYSLIPS.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No payslips available yet.</div>
            ) : MOCK_PAYSLIPS.map((slip) => (
              <div key={slip.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedPayslip(expandedPayslip === slip.id ? null : slip.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <CreditCard size={18} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900">{slip.month} {slip.year}</p>
                    <p className="text-xs text-slate-500">Net Pay: <span className="font-semibold text-emerald-700">{formatCurrency(slip.net_salary)}</span></p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Generated</span>
                    {expandedPayslip === slip.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </button>

                {expandedPayslip === slip.id && (
                  <div className="border-t border-slate-100 px-5 py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                      <div className="bg-slate-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-slate-500 mb-1">Gross Salary</p>
                        <p className="text-lg font-bold text-slate-900">{formatCurrency(slip.gross_salary)}</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-slate-500 mb-1">Deductions</p>
                        <p className="text-lg font-bold text-red-700">- {formatCurrency(slip.deductions)}</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-slate-500 mb-1">Net Pay</p>
                        <p className="text-lg font-bold text-emerald-700">{formatCurrency(slip.net_salary)}</p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      {[
                        { label: 'Basic Salary', amount: slip.gross_salary * 0.5, type: 'earning' },
                        { label: 'HRA', amount: slip.gross_salary * 0.2, type: 'earning' },
                        { label: 'Special Allowance', amount: slip.gross_salary * 0.3, type: 'earning' },
                        { label: 'Provident Fund', amount: slip.deductions * 0.6, type: 'deduction' },
                        { label: 'Professional Tax', amount: slip.deductions * 0.2, type: 'deduction' },
                        { label: 'TDS', amount: slip.deductions * 0.2, type: 'deduction' },
                      ].map(({ label, amount, type }) => (
                        <div key={label} className="flex justify-between text-sm">
                          <span className="text-slate-600">{label}</span>
                          <span className={type === 'deduction' ? 'text-red-600 font-medium' : 'text-slate-800 font-medium'}>
                            {type === 'deduction' ? '- ' : ''}{formatCurrency(amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => toast.info('Payroll system not yet integrated — download will be available once configured.')}
                      className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors"
                    >
                      <Download size={14} /> Download Payslip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── DOCUMENTS TAB ── */}
        {activeTab === 'documents' && (
          <div className="space-y-5">
            {/* Upload Section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><Upload size={14} className="text-blue-600" /></div>
                <h3 className="text-sm font-bold text-slate-800">Upload Document</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Document Name</label>
                  <input value={uploadDocName} onChange={(e) => setUploadDocName(e.target.value)} placeholder="e.g. Aadhaar Card"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">Document Type</label>
                  <select value={uploadDocType} onChange={(e) => setUploadDocType(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800 bg-white">
                    {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 mb-1 block">File (max 10MB)</label>
                  <label className={`flex items-center gap-2 text-sm border-2 border-dashed rounded-lg px-3 py-2 cursor-pointer transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : 'border-blue-200 hover:border-blue-400 text-blue-600'}`}>
                    <Upload size={14} />
                    <span>{uploading ? 'Uploading…' : 'Choose file'}</span>
                    <input ref={fileInputRef} type="file" className="hidden" disabled={uploading} onChange={handleDocumentUpload} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  </label>
                </div>
              </div>
            </div>

            {/* Documents List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800">Uploaded Documents</h3>
                <p className="text-xs text-slate-500 mt-0.5">{documents.length} document{documents.length !== 1 ? 's' : ''} on file</p>
              </div>
              {documents.length === 0 ? (
                <div className="py-12 text-center px-5">
                  <FileText size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-500">No documents uploaded yet</p>
                  <p className="text-xs text-slate-400 mt-1">Upload your ID, certificates, and other required documents above</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {documents.map((doc) => {
                    const sc = docStatusConfig[doc.doc_status] || docStatusConfig.pending;
                    const StatusIcon = sc.icon;
                    return (
                      <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <FileText size={16} className="text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{doc.document_name}</p>
                          <p className="text-xs text-slate-500">{doc.document_type} · {formatBytes(doc.file_size)} · {new Date(doc.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${sc.color}`}>
                            <StatusIcon size={10} /> {sc.label}
                          </span>
                          {doc.file_url && (
                            <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold transition-colors">
                              <Download size={12} /> Download
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SKILLS TAB ── */}
        {activeTab === 'skills' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><Award size={14} className="text-amber-600" /></div>
              <h3 className="text-sm font-bold text-slate-800">Skills & Expertise</h3>
            </div>
            {editing ? (
              <>
                <div className="flex gap-2 mb-4">
                  <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddSkill()}
                    placeholder="Add a skill (press Enter)" className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300 text-slate-800" />
                  <button onClick={handleAddSkill} className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                    <Plus size={14} /> Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(editData.skills || []).map((skill, idx) => (
                    <span key={idx} className="flex items-center gap-1.5 text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">
                      {skill}
                      <button onClick={() => handleRemoveSkill(idx)} className="hover:text-red-500 transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                  {(editData.skills || []).length === 0 && <p className="text-sm text-slate-400">No skills added yet</p>}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(profile?.skills || []).map((skill, idx) => (
                  <span key={idx} className="text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">{skill}</span>
                ))}
                {(profile?.skills || []).length === 0 && (
                  <div className="text-center w-full py-8">
                    <Award size={28} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">No skills added yet</p>
                    <p className="text-xs text-slate-400 mt-1">Click Edit Profile to add your skills</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

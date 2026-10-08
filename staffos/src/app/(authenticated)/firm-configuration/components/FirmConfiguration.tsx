'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Building2, Clock, Calendar, MapPin, Briefcase, ChevronDown, ChevronUp, Save, Plus, Trash2, AlertTriangle, Loader2, GitBranch, Share2, X, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addWeeklyHolidays,
  listWeeklyHolidays,
  removeWeeklyHolidays,
  plusMonthsStr,
  todayStr,
  WEEKDAY_NAMES,
  type WeeklyHolidayRule,
} from '@/lib/weeklyHolidays';
import { Toaster } from 'sonner';

interface LeaveQuota {
  role: string;
  substitute: number;
  paid: number;
  unpaid: number;
  medical: number;
  half_day: number;
}

interface Holiday {
  id: string;
  name: string;
  date: string;
  type: 'national' | 'regional' | 'company';
}

interface WorkingHoursConfig {
  standard_start: string;
  standard_end: string;
  break_minutes: number;
  weekly_hours: number;
  daily_hours: number;
  overtime_threshold_daily: number;
  overtime_threshold_weekly: number;
  overtime_threshold_monthly: number;
}

interface LocationRadiusConfig {
  default_radius_meters: number;
  office_name: string;
  center_latitude: number;
  center_longitude: number;
  enforce_radius: boolean;
  block_clock_in: boolean;
}

interface FinancialYearConfig {
  start_month: number;
  start_day: number;
  current_fy_start: string;
  current_fy_end: string;
}

const emptyLeaveQuotas: LeaveQuota[] = [
  { role: 'Employee',  substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Manager',   substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Executive', substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Director',  substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
];

const defaultWorkingHours: WorkingHoursConfig = {
  standard_start: '09:00',
  standard_end: '18:00',
  break_minutes: 60,
  weekly_hours: 40,
  daily_hours: 8,
  overtime_threshold_daily: 2,
  overtime_threshold_weekly: 10,
  overtime_threshold_monthly: 40,
};

const defaultFinancialYear: FinancialYearConfig = {
  start_month: 4,
  start_day: 1,
  current_fy_start: '2026-04-01',
  current_fy_end: '2027-03-31',
};

const defaultLocationRadius: LocationRadiusConfig = {
  default_radius_meters: 200,
  office_name: 'Head Office',
  center_latitude: 0,
  center_longitude: 0,
  enforce_radius: true,
  block_clock_in: false,
};

type SectionId = 'working_hours' | 'leave' | 'holidays' | 'location' | 'financial_year' | 'payroll' | 'firms';

interface Firm {
  id: string;
  name: string;
  legal_name: string | null;
  code: string;
  firm_type: 'holding' | 'parent' | 'subsidiary' | 'branch';
  parent_firm_id: string | null;
  is_active: boolean;
  settings?: { weekly_off_days?: number[] } | null;
}

interface FirmSharing {
  id: string;
  source_firm_id: string;
  target_firm_id: string;
  module: string;
  is_active: boolean;
}

const MODULE_OPTIONS = ['tasks', 'calendar', 'chat', 'leave', 'attendance', 'location', 'reports', 'all'];

const typeColors: Record<Holiday['type'], string> = {
  national: 'bg-blue-100 text-blue-700',
  regional: 'bg-purple-100 text-purple-700',
  company: 'bg-amber-100 text-amber-700',
};

export default function FirmConfiguration() {
  const { user, effectiveUserId, pinSession } = useAuth();
  const supabase = createClient();

  // Weekly holidays are director-only and are written straight to company_holidays.
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const isDirector = profileRole === 'director' || pinSession?.role === 'director';
  const [weeklyRules, setWeeklyRules] = useState<WeeklyHolidayRule[]>([]);
  const [weeklySaving, setWeeklySaving] = useState(false);
  const [newWeekly, setNewWeekly] = useState(() => ({
    weekday: 0,
    name: '',
    from: todayStr(),
    to: plusMonthsStr(todayStr(), 12),
  }));

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from('user_profiles')
      .select('role')
      .eq('id', effectiveUserId)
      .maybeSingle()
      .then(({ data }) => setProfileRole((data?.role as string) ?? null));
  }, [effectiveUserId]);

  const loadWeeklyRules = useCallback(async () => {
    try {
      setWeeklyRules(await listWeeklyHolidays(supabase));
    } catch (err: any) {
      toast.error(err.message || 'Failed to load weekly holidays');
    }
  }, []);

  useEffect(() => {
    if (isDirector) loadWeeklyRules();
  }, [isDirector, loadWeeklyRules]);

  const [openSection, setOpenSection] = useState<SectionId>('working_hours');
  const [leaveQuotas, setLeaveQuotas] = useState<LeaveQuota[]>(emptyLeaveQuotas);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHoursConfig>(defaultWorkingHours);
  const [financialYear, setFinancialYear] = useState<FinancialYearConfig>(defaultFinancialYear);
  const [locationRadius, setLocationRadius] = useState<LocationRadiusConfig>(defaultLocationRadius);
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '', type: 'national' as Holiday['type'] });
  const [saving, setSaving] = useState<SectionId | null>(null);
  const [loading, setLoading] = useState(true);

  const [firms, setFirms] = useState<Firm[]>([]);
  const [salarySchedule, setSalarySchedule] = useState({ day_of_month: 1, label: 'Salary Day' });
  const [sharingRules, setSharingRules] = useState<FirmSharing[]>([]);
  const [newFirm, setNewFirm] = useState({ name: '', code: '', firm_type: 'subsidiary' as Firm['firm_type'], parent_firm_id: '', weekly_off_days: [0] as number[] });
  const [editingFirmId, setEditingFirmId] = useState<string | null>(null);
  const [newSharing, setNewSharing] = useState({ source_firm_id: '', target_firm_id: '', module: 'tasks' });
  const [firmsLoading, setFirmsLoading] = useState(false);

  const fetchFirms = useCallback(async () => {
    setFirmsLoading(true);
    const [firmsRes, sharingRes] = await Promise.all([
      supabase.from('firms').select('*').order('created_at', { ascending: true }),
      supabase.from('firm_data_sharing').select('*'),
    ]);
    if (firmsRes.data) setFirms(firmsRes.data as Firm[]);
    if (sharingRes.data) setSharingRules(sharingRes.data as FirmSharing[]);
    setFirmsLoading(false);
  }, []);

  useEffect(() => { fetchFirms(); }, [fetchFirms]);

  const firmName = (id: string) => firms.find((f) => f.id === id)?.name || '—';

  const startEditFirm = (f: Firm) => {
    setEditingFirmId(f.id);
    setNewFirm({ name: f.name, code: f.code, firm_type: f.firm_type, parent_firm_id: f.parent_firm_id || '', weekly_off_days: f.settings?.weekly_off_days || [0] });
  };

  const cancelEditFirm = () => {
    setEditingFirmId(null);
    setNewFirm({ name: '', code: '', firm_type: 'subsidiary', parent_firm_id: '', weekly_off_days: [0] });
  };

  const toggleWeeklyOffDay = (day: number) => {
    setNewFirm((f) => ({
      ...f,
      weekly_off_days: f.weekly_off_days.includes(day)
        ? f.weekly_off_days.filter((d) => d !== day)
        : [...f.weekly_off_days, day].sort(),
    }));
  };

  const createFirm = async () => {
    if (!newFirm.name.trim() || !newFirm.code.trim()) {
      toast.error('Firm name and code are required');
      return;
    }

    if (editingFirmId) {
      const { error } = await supabase.from('firms').update({
        name: newFirm.name.trim(),
        code: newFirm.code.trim().toUpperCase(),
        firm_type: newFirm.firm_type,
        parent_firm_id: newFirm.parent_firm_id || null,
        settings: { weekly_off_days: newFirm.weekly_off_days },
      }).eq('id', editingFirmId);
      if (error) { toast.error(error.message || 'Failed to update firm — code may already be in use'); return; }
      toast.success('Firm updated');
      cancelEditFirm();
      fetchFirms();
      return;
    }

    const { error } = await supabase.from('firms').insert({
      name: newFirm.name.trim(),
      code: newFirm.code.trim().toUpperCase(),
      firm_type: newFirm.firm_type,
      parent_firm_id: newFirm.parent_firm_id || null,
      settings: { weekly_off_days: newFirm.weekly_off_days },
    });
    if (error) { toast.error(error.message || 'Failed to create firm — code may already be in use'); return; }
    toast.success('Firm added');
    setNewFirm({ name: '', code: '', firm_type: 'subsidiary', parent_firm_id: '', weekly_off_days: [0] });
    fetchFirms();
  };

  const toggleFirmActive = async (f: Firm) => {
    const { error } = await supabase.from('firms').update({ is_active: !f.is_active }).eq('id', f.id);
    if (error) { toast.error('Failed to update'); return; }
    fetchFirms();
  };

  const deleteFirm = async (f: Firm) => {
    if (!confirm(`Permanently delete "${f.name}"? This cannot be undone. Records that belonged to this firm will keep existing but lose their firm assignment (firm_id becomes empty), and any subsidiaries under it will become top-level firms.`)) return;
    const { error } = await supabase.from('firms').delete().eq('id', f.id);
    if (error) { toast.error(error.message || 'Failed to delete firm'); return; }
    toast.success('Firm permanently deleted');
    if (editingFirmId === f.id) cancelEditFirm();
    fetchFirms();
  };

  const createSharingRule = async () => {
    if (!newSharing.source_firm_id || !newSharing.target_firm_id) {
      toast.error('Choose both firms');
      return;
    }
    if (newSharing.source_firm_id === newSharing.target_firm_id) {
      toast.error('Source and target firm must be different');
      return;
    }
    const { error } = await supabase.from('firm_data_sharing').insert({
      source_firm_id: newSharing.source_firm_id,
      target_firm_id: newSharing.target_firm_id,
      module: newSharing.module,
    });
    if (error) { toast.error(error.message || 'Failed to add sharing rule'); return; }
    toast.success('Data sharing rule added');
    setNewSharing({ source_firm_id: '', target_firm_id: '', module: 'tasks' });
    fetchFirms();
  };

  const removeSharingRule = async (id: string) => {
    const { error } = await supabase.from('firm_data_sharing').delete().eq('id', id);
    if (error) { toast.error('Failed to remove'); return; }
    fetchFirms();
  };

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('director_settings')
        .select('setting_key, setting_value');
      if (data) {
        data.forEach((row) => {
          if (row.setting_key === 'working_hours' && row.setting_value) {
            setWorkingHours({ ...defaultWorkingHours, ...row.setting_value });
          }
          if (row.setting_key === 'financial_year' && row.setting_value) {
            setFinancialYear({ ...defaultFinancialYear, ...row.setting_value });
          }
          if (row.setting_key === 'salary_schedule' && row.setting_value) {
            setSalarySchedule({ day_of_month: 1, label: 'Salary Day', ...row.setting_value });
          }
          if (row.setting_key === 'leave_quotas_by_fy' && row.setting_value) {
            const qData = row.setting_value;
            setLeaveQuotas([
              { role: 'Employee',  ...emptyLeaveQuotas[0], ...(qData.employee  || {}) },
              { role: 'Manager',   ...emptyLeaveQuotas[1], ...(qData.manager   || {}) },
              { role: 'Executive', ...emptyLeaveQuotas[2], ...(qData.executive || {}) },
              { role: 'Director',  ...emptyLeaveQuotas[3], ...(qData.director  || {}) },
            ]);
          }
          if (row.setting_key === 'location_radius' && row.setting_value) {
            setLocationRadius({ ...defaultLocationRadius, ...row.setting_value });
          }
          if (row.setting_key === 'holidays_list' && row.setting_value) {
            setHolidays(row.setting_value as Holiday[]);
          }
        });
      }
    } catch {}
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSetting = async (key: string, value: object) => {
    const uid = effectiveUserId;
    // Try upsert with updated_by
    const { error } = await supabase
      .from('director_settings')
      .upsert({ setting_key: key, setting_value: value, updated_by: uid }, { onConflict: 'setting_key' });
    if (error) {
      // Retry without updated_by in case column doesn't exist
      const { error: error2 } = await supabase
        .from('director_settings')
        .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
      if (error2) throw error2;
    }
  };

  const handleSave = async (section: SectionId) => {
    setSaving(section);
    try {
      if (section === 'working_hours') {
        await saveSetting('working_hours', workingHours);
      } else if (section === 'payroll') {
        await saveSetting('salary_schedule', salarySchedule);
      } else if (section === 'financial_year') {
        await saveSetting('financial_year', financialYear);
      } else if (section === 'leave') {
        const quotaMap: Record<string, object> = {};
        leaveQuotas.forEach((q) => {
          quotaMap[q.role.toLowerCase()] = {
            substitute: q.substitute, paid: q.paid, unpaid: q.unpaid,
            medical: q.medical, half_day: q.half_day,
          };
        });
        await saveSetting('leave_quotas_by_fy', quotaMap);

        // ── Sync leave_balances for all users ──
        // Determine current fiscal year (April start)
        const now = new Date();
        const fiscalYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

        try {
          // Fetch all user profiles to get their roles
          const { data: allUsers } = await supabase
            .from('user_profiles')
            .select('id, role');

          if (allUsers && allUsers.length > 0) {
            const leaveTypes: Array<keyof Omit<LeaveQuota, 'role'>> = ['substitute', 'paid', 'unpaid', 'medical', 'half_day'];

            const upsertRows = allUsers.flatMap((u: { id: string; role: string }) => {
              // Find matching quota for this user's role
              const roleKey = u.role?.toLowerCase() || 'employee';
              const quota = leaveQuotas.find(q => q.role.toLowerCase() === roleKey)
                || leaveQuotas.find(q => q.role.toLowerCase() === 'employee')
                || leaveQuotas[0];

              return leaveTypes.map(lt => ({
                user_id: u.id,
                leave_type: lt,
                total_days: quota[lt],
                fiscal_year: fiscalYear,
              }));
            });

            // Upsert in batches of 50 to avoid request size limits
            for (let i = 0; i < upsertRows.length; i += 50) {
              const batch = upsertRows.slice(i, i + 50);
              await supabase
                .from('leave_balances')
                .upsert(batch, { onConflict: 'user_id,leave_type,fiscal_year', ignoreDuplicates: false });
            }
          }
        } catch (syncErr) {
          console.warn('Leave balance sync warning:', syncErr);
          // Don't throw — settings were saved, sync is best-effort
        }
      } else if (section === 'location') {
        await saveSetting('location_radius', locationRadius);
        // Also upsert into location_settings as firm default
        try {
          await supabase.from('location_settings').upsert({
            firm_default: true,
            office_name: locationRadius.office_name,
            center_latitude: locationRadius.center_latitude,
            center_longitude: locationRadius.center_longitude,
            radius_meters: locationRadius.default_radius_meters,
            created_by: effectiveUserId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'firm_default' });
        } catch {}
      } else if (section === 'holidays') {
        await saveSetting('holidays_list', holidays as unknown as object);
      }
      toast.success('Settings saved successfully', { duration: 2000 });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(null);
    }
  };

  const updateLeaveQuota = (index: number, field: keyof Omit<LeaveQuota, 'role'>, value: number) => {
    setLeaveQuotas((prev) => prev.map((q, i) => (i === index ? { ...q, [field]: value } : q)));
  };

  const addHoliday = () => {
    if (!newHoliday.name.trim() || !newHoliday.date) {
      toast.error('Please enter holiday name and date');
      return;
    }
    setHolidays((prev) => [...prev, { ...newHoliday, id: `h${Date.now()}` }]);
    setNewHoliday({ name: '', date: '', type: 'national' });
    toast.success('Holiday added — click Save Holidays to persist');
  };

  const removeHoliday = (id: string) => {
    setHolidays((prev) => prev.filter((h) => h.id !== id));
  };

  const handleAddWeekly = async () => {
    if (!newWeekly.name.trim()) {
      toast.error('Enter a name for the weekly holiday');
      return;
    }
    if (!newWeekly.from || !newWeekly.to || newWeekly.to < newWeekly.from) {
      toast.error('Pick a valid from and to date');
      return;
    }
    setWeeklySaving(true);
    try {
      const { added, skipped } = await addWeeklyHolidays(supabase, {
        weekday: newWeekly.weekday,
        from: newWeekly.from,
        to: newWeekly.to,
        name: newWeekly.name.trim(),
        createdBy: effectiveUserId,
      });
      toast.success(
        `Every ${WEEKDAY_NAMES[newWeekly.weekday]} added — ${added} date${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already marked` : ''}`
      );
      setNewWeekly((p) => ({ ...p, name: '' }));
      await loadWeeklyRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add weekly holiday');
    } finally {
      setWeeklySaving(false);
    }
  };

  const handleRemoveWeekly = async (weekday: number) => {
    try {
      const removed = await removeWeeklyHolidays(supabase, { weekday });
      toast.success(`Every ${WEEKDAY_NAMES[weekday]} rule removed — ${removed} date${removed === 1 ? '' : 's'} cleared`);
      await loadWeeklyRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove weekly holiday');
    }
  };

  const sections: { id: SectionId; label: string; icon: React.ElementType; desc: string }[] = [
    { id: 'working_hours',  label: 'Working Hours',         icon: Clock,     desc: 'Standard hours, breaks & overtime thresholds' },
    { id: 'leave',          label: 'Leave Quotas (per FY)', icon: Calendar,  desc: 'Annual leave days per role — Substitute, Paid, Unpaid, Medical, Half Day' },
    { id: 'holidays',       label: 'Public Holidays',       icon: Calendar,  desc: 'Company-wide holiday calendar' },
    { id: 'location',       label: 'Location Radius',       icon: MapPin,    desc: 'Default GPS radius for clock-in/out enforcement' },
    { id: 'financial_year', label: 'Financial Year',        icon: Briefcase, desc: 'Set the financial year start and end dates' },
    { id: 'payroll',        label: 'Payroll',               icon: Calendar,  desc: 'Set the recurring salary disbursement day shown on the Calendar' },
    { id: 'firms',          label: 'Firms & Subsidiaries',  icon: GitBranch, desc: 'Add subsidiary firms and control what data is shared between them' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <>
      <Toaster position="bottom-right" richColors />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
          <Building2 size={20} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Firm Configuration</h1>
          <p className="text-sm text-slate-500">Configure working hours, holidays, leave quotas & location radius</p>
        </div>
        <div className="ml-auto flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <AlertTriangle size={13} className="text-amber-600" />
          <span className="text-xs font-semibold text-amber-700">Changes apply to all employees immediately</span>
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((sec) => {
          const SIcon = sec.icon;
          const isOpen = openSection === sec.id;
          return (
            <div key={sec.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setOpenSection(sec.id)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <SIcon size={16} className="text-slate-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">{sec.label}</p>
                  <p className="text-xs text-slate-500">{sec.desc}</p>
                </div>
                {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-5 py-5">

                  {/* Working Hours */}
                  {sec.id === 'working_hours' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Standard Start Time</p>
                          <input type="time" value={workingHours.standard_start}
                            onChange={(e) => setWorkingHours({ ...workingHours, standard_start: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Standard End Time</p>
                          <input type="time" value={workingHours.standard_end}
                            onChange={(e) => setWorkingHours({ ...workingHours, standard_end: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                      </div>
                      {[
                        { key: 'break_minutes',              label: 'Break Duration (minutes)',           min: 0,  max: 120 },
                        { key: 'daily_hours',                label: 'Standard Daily Hours',               min: 1,  max: 24  },
                        { key: 'weekly_hours',               label: 'Standard Weekly Hours',              min: 1,  max: 80  },
                        { key: 'overtime_threshold_daily',   label: 'Daily Overtime Threshold (hours)',   min: 0,  max: 8   },
                        { key: 'overtime_threshold_weekly',  label: 'Weekly Overtime Cap (hours)',        min: 0,  max: 40  },
                        { key: 'overtime_threshold_monthly', label: 'Monthly Overtime Cap (hours)',       min: 0,  max: 160 },
                      ].map((field) => (
                        <div key={field.key} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
                          <p className="text-sm font-semibold text-slate-800">{field.label}</p>
                          <input type="number" min={field.min} max={field.max}
                            value={workingHours[field.key as keyof WorkingHoursConfig] as number}
                            onChange={(e) => setWorkingHours({ ...workingHours, [field.key]: parseInt(e.target.value) || 0 })}
                            className="w-20 text-center border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <button onClick={() => handleSave('working_hours')} disabled={saving === 'working_hours'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                          {saving === 'working_hours' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'working_hours' ? 'Saving…' : 'Save Working Hours'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Leave Quotas — aligned with 5 leave types */}
                  {sec.id === 'leave' && (
                    <div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100">
                              <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Substitute</th>
                              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Paid</th>
                              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unpaid</th>
                              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Medical</th>
                              <th className="text-center py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Half Day</th>
                              <th className="text-center py-2 pl-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {leaveQuotas.map((q, i) => (
                              <tr key={q.role} className="hover:bg-slate-50">
                                <td className="py-3 pr-4"><span className="font-semibold text-slate-800">{q.role}</span></td>
                                {(['substitute', 'paid', 'unpaid', 'medical', 'half_day'] as const).map((field) => (
                                  <td key={field} className="py-3 px-2 text-center">
                                    <input type="number" min={0} max={365} value={q[field]}
                                      onChange={(e) => updateLeaveQuota(i, field, parseInt(e.target.value) || 0)}
                                      className="w-14 text-center border border-slate-200 rounded-lg px-1 py-1.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                                  </td>
                                ))}
                                <td className="py-3 pl-3 text-center">
                                  <span className="text-sm font-bold text-violet-700">{q.substitute + q.paid + q.unpaid + q.medical + q.half_day}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex justify-end mt-4">
                        <button onClick={() => handleSave('leave')} disabled={saving === 'leave'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                          {saving === 'leave' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'leave' ? 'Saving…' : 'Save Leave Quotas'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Holidays */}
                  {sec.id === 'holidays' && (
                    <div>
                      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                        {holidays.length === 0 && (
                          <div className="py-6 text-center text-sm text-slate-400">No holidays configured yet</div>
                        )}
                        {holidays.map((h) => (
                          <div key={h.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">{h.name}</p>
                              <p className="text-xs text-slate-500">{new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeColors[h.type]}`}>{h.type}</span>
                            <button onClick={() => removeHoliday(h.id)} className="p-1.5 hover:bg-red-100 rounded-lg transition-colors">
                              <Trash2 size={13} className="text-red-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs font-semibold text-slate-600 mb-3">Add New Holiday</p>
                        <div className="flex gap-2 flex-wrap">
                          <input type="text" placeholder="Holiday name" value={newHoliday.name}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                          <input type="date" value={newHoliday.date}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                          <select value={newHoliday.type}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, type: e.target.value as Holiday['type'] }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                            <option value="national">National</option>
                            <option value="regional">Regional</option>
                            <option value="company">Company</option>
                          </select>
                          <button onClick={addHoliday}
                            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
                            <Plus size={14} /> Add
                          </button>
                        </div>
                      </div>
                      {isDirector && (
                        <div className="border-t border-slate-100 pt-4 mt-4">
                          <p className="text-xs font-semibold text-slate-600 mb-1">
                            Weekly holiday <span className="text-[10px] font-normal text-violet-600">(directors only)</span>
                          </p>
                          <p className="text-[11px] text-slate-500 mb-3">
                            Marks every chosen weekday in the date range as a holiday for attendance and payroll. Saved immediately.
                          </p>

                          {weeklyRules.length > 0 && (
                            <div className="space-y-2 mb-3">
                              {weeklyRules.map((r) => (
                                <div key={r.weekday} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                  <div className="flex-1">
                                    <p className="text-sm font-semibold text-slate-800">Every {WEEKDAY_NAMES[r.weekday]} — {r.name}</p>
                                    <p className="text-xs text-slate-500">
                                      {r.count} upcoming date{r.count === 1 ? '' : 's'} · until {new Date(r.lastDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </p>
                                  </div>
                                  <button onClick={() => handleRemoveWeekly(r.weekday)}
                                    aria-label={`Remove every ${WEEKDAY_NAMES[r.weekday]} holiday`}
                                    className="p-1.5 hover:bg-red-100 rounded-lg transition-colors">
                                    <Trash2 size={13} className="text-red-500" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2 flex-wrap">
                            <select value={newWeekly.weekday}
                              onChange={(e) => setNewWeekly((p) => ({ ...p, weekday: Number(e.target.value) }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                              {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                            </select>
                            <input type="text" placeholder="Name (e.g. Weekly Off)" value={newWeekly.name}
                              onChange={(e) => setNewWeekly((p) => ({ ...p, name: e.target.value }))}
                              className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                            <input type="date" value={newWeekly.from} aria-label="From"
                              onChange={(e) => setNewWeekly((p) => ({ ...p, from: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                            <input type="date" value={newWeekly.to} aria-label="To"
                              onChange={(e) => setNewWeekly((p) => ({ ...p, to: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                            <button onClick={handleAddWeekly} disabled={weeklySaving}
                              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors">
                              {weeklySaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                              Add weekly
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end mt-4">
                        <button onClick={() => handleSave('holidays')} disabled={saving === 'holidays'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                          {saving === 'holidays' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'holidays' ? 'Saving…' : 'Save Holidays'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Location Radius */}
                  {sec.id === 'location' && (
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-blue-700">This sets the firm-wide default GPS radius. Individual employee overrides can be set from the Live Location Map page.</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Office Name</p>
                          <input type="text" value={locationRadius.office_name}
                            onChange={(e) => setLocationRadius({ ...locationRadius, office_name: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Default Radius (meters)</p>
                          <input type="number" min={50} max={5000} value={locationRadius.default_radius_meters}
                            onChange={(e) => setLocationRadius({ ...locationRadius, default_radius_meters: parseInt(e.target.value) || 200 })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Office Latitude</p>
                          <input type="number" step="0.000001" value={locationRadius.center_latitude}
                            onChange={(e) => setLocationRadius({ ...locationRadius, center_latitude: parseFloat(e.target.value) || 0 })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Office Longitude</p>
                          <input type="number" step="0.000001" value={locationRadius.center_longitude}
                            onChange={(e) => setLocationRadius({ ...locationRadius, center_longitude: parseFloat(e.target.value) || 0 })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Enforce Radius on Clock-In</p>
                          <p className="text-xs text-slate-500 mt-0.5">Warn employees and notify director when clocking in outside the allowed radius</p>
                        </div>
                        <button
                          onClick={() => setLocationRadius({ ...locationRadius, enforce_radius: !locationRadius.enforce_radius })}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${locationRadius.enforce_radius ? 'bg-violet-600' : 'bg-slate-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${locationRadius.enforce_radius ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-xl">
                        <div>
                          <p className="text-sm font-semibold text-red-800">Block Clock-In Outside Radius</p>
                          <p className="text-xs text-red-600 mt-0.5">Hard block — employees cannot clock in if outside the allowed radius (prevents location fraud)</p>
                        </div>
                        <button
                          onClick={() => setLocationRadius({ ...locationRadius, block_clock_in: !locationRadius.block_clock_in })}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${locationRadius.block_clock_in ? 'bg-red-600' : 'bg-slate-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${locationRadius.block_clock_in ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <div className="flex justify-end">
                        <button onClick={() => handleSave('location')} disabled={saving === 'location'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                          {saving === 'location' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'location' ? 'Saving…' : 'Save Location Settings'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Financial Year */}
                  {sec.id === 'financial_year' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">FY Start Month</p>
                          <select value={financialYear.start_month}
                            onChange={(e) => setFinancialYear({ ...financialYear, start_month: Number(e.target.value) })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                            {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                              <option key={i} value={i + 1}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">FY Start Day</p>
                          <input type="number" min={1} max={31} value={financialYear.start_day}
                            onChange={(e) => setFinancialYear({ ...financialYear, start_day: Number(e.target.value) })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Current FY Start Date</p>
                          <input type="date" value={financialYear.current_fy_start}
                            onChange={(e) => setFinancialYear({ ...financialYear, current_fy_start: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Current FY End Date</p>
                          <input type="date" value={financialYear.current_fy_end}
                            onChange={(e) => setFinancialYear({ ...financialYear, current_fy_end: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button onClick={() => handleSave('financial_year')} disabled={saving === 'financial_year'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                          {saving === 'financial_year' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'financial_year' ? 'Saving…' : 'Save Financial Year'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Payroll — recurring salary day */}
                  {sec.id === 'payroll' && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-500">
                        Shows a recurring "Salary Day" marker on the company Calendar every month. This is just a visible reminder — it doesn't process payroll itself.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-slate-600 mb-1 block">Day of month</label>
                          <input type="number" min={1} max={31} value={salarySchedule.day_of_month}
                            onChange={(e) => setSalarySchedule({ ...salarySchedule, day_of_month: Number(e.target.value) })}
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white" />
                          <p className="text-[11px] text-slate-400 mt-1">If a month has fewer days (e.g. 31 in a 30-day month), it falls on the last day instead.</p>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-600 mb-1 block">Label</label>
                          <input value={salarySchedule.label} onChange={(e) => setSalarySchedule({ ...salarySchedule, label: e.target.value })}
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 bg-white" />
                        </div>
                      </div>
                      <button onClick={() => handleSave('payroll')} disabled={saving === 'payroll'}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50">
                        {saving === 'payroll' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {saving === 'payroll' ? 'Saving…' : 'Save Payroll Schedule'}
                      </button>
                    </div>
                  )}

                  {/* Firms & Subsidiaries */}
                  {sec.id === 'firms' && (
                    <div className="space-y-6">
                      {firmsLoading ? (
                        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-violet-500" /></div>
                      ) : (
                        <>
                          {/* Existing firms */}
                          <div>
                            <p className="text-xs font-semibold text-slate-600 mb-2">Firms ({firms.length})</p>
                            <div className="space-y-2">
                              {firms.map((f) => (
                                <div key={f.id} className={`flex items-center gap-3 p-3 rounded-xl border ${f.is_active ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-slate-50 opacity-50'}`}>
                                  <Building2 size={16} className="text-violet-600 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-800">{f.name} <span className="text-xs font-normal text-slate-400">({f.code})</span></p>
                                    <p className="text-xs text-slate-500">
                                      {f.firm_type}{f.parent_firm_id ? ` · under ${firmName(f.parent_firm_id)}` : ''}
                                    </p>
                                  </div>
                                  <button onClick={() => startEditFirm(f)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center gap-1">
                                    <Edit2 size={12} /> Edit
                                  </button>
                                  <button onClick={() => toggleFirmActive(f)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
                                    {f.is_active ? 'Deactivate' : 'Activate'}
                                  </button>
                                  <button onClick={() => deleteFirm(f)} title="Delete permanently" className="text-xs font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 flex items-center gap-1">
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Add firm form */}
                          <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                            <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                              {editingFirmId ? <><Edit2 size={13} /> Editing firm</> : <><Plus size={13} /> Add a firm or subsidiary</>}
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <input placeholder="Firm name" value={newFirm.name} onChange={(e) => setNewFirm({ ...newFirm, name: e.target.value })}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                              <input placeholder="Short code (e.g. DGAJ-BLR)" value={newFirm.code} onChange={(e) => setNewFirm({ ...newFirm, code: e.target.value })}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
                              <select value={newFirm.firm_type} onChange={(e) => setNewFirm({ ...newFirm, firm_type: e.target.value as Firm['firm_type'] })}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                                <option value="holding">Holding company</option>
                                <option value="parent">Parent firm</option>
                                <option value="subsidiary">Subsidiary</option>
                                <option value="branch">Branch</option>
                              </select>
                              <select value={newFirm.parent_firm_id} onChange={(e) => setNewFirm({ ...newFirm, parent_firm_id: e.target.value })}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                                <option value="">No parent firm</option>
                                {firms.filter((f) => f.id !== editingFirmId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Weekly off day(s) — used for attendance and payroll</label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => (
                                  <button key={day} type="button" onClick={() => toggleWeeklyOffDay(day)}
                                    className={`text-xs font-600 px-3 py-1.5 rounded-lg border transition-colors ${
                                      newFirm.weekly_off_days.includes(day)
                                        ? 'bg-violet-600 border-violet-600 text-white'
                                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={createFirm} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                                {editingFirmId ? <><Save size={14} /> Save changes</> : <><Plus size={14} /> Add Firm</>}
                              </button>
                              {editingFirmId && (
                                <button onClick={cancelEditFirm} className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Data sharing between firms */}
                          <div>
                            <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5"><Share2 size={13} /> Data sharing between firms</p>
                            <p className="text-xs text-slate-500 mb-3">By default every firm's data is completely separate. Add a rule to let one firm's module be visible to another (e.g. the holding company sees a subsidiary's tasks).</p>
                            <div className="space-y-2 mb-3">
                              {sharingRules.length === 0 && <p className="text-xs text-slate-400 italic">No sharing rules yet — all firms are fully isolated.</p>}
                              {sharingRules.map((r) => (
                                <div key={r.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs">
                                  <span className="font-semibold text-slate-700">{firmName(r.source_firm_id)}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="font-semibold text-slate-700">{firmName(r.target_firm_id)}</span>
                                  <span className="ml-auto px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">{r.module}</span>
                                  <button onClick={() => removeSharingRule(r.id)} className="text-slate-400 hover:text-red-500"><X size={13} /></button>
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <select value={newSharing.source_firm_id} onChange={(e) => setNewSharing({ ...newSharing, source_firm_id: e.target.value })}
                                className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white">
                                <option value="">Data from…</option>
                                {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                              <select value={newSharing.target_firm_id} onChange={(e) => setNewSharing({ ...newSharing, target_firm_id: e.target.value })}
                                className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white">
                                <option value="">Visible to…</option>
                                {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                              <select value={newSharing.module} onChange={(e) => setNewSharing({ ...newSharing, module: e.target.value })}
                                className="border border-slate-200 rounded-lg px-2 py-2 text-xs bg-white">
                                {MODULE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                            <button onClick={createSharingRule} className="mt-2 flex items-center gap-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                              <Plus size={12} /> Add sharing rule
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
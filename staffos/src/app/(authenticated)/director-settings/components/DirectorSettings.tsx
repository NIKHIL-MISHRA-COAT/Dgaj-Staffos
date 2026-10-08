'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Settings, Shield, Calendar, Clock, Briefcase, ChevronDown, ChevronUp, Save, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { rolloverLeave, getFiscalYear } from '@/lib/leaveRollover';

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

interface TaskLimits {
  maxConcurrent: number;
  maxOverdueDays: number;
  dailyLimit: number;
}

interface OvertimeThresholds {
  dailyHours: number;
  weeklyHours: number;
  monthlyHours: number;
}

interface ShiftConfig {
  morningStart: string;
  morningEnd: string;
  eveningStart: string;
  eveningEnd: string;
  nightStart: string;
  nightEnd: string;
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

interface FinancialYearConfig {
  start_month: number;
  start_day: number;
  current_fy_start: string;
  current_fy_end: string;
}

const defaultLeaveQuotas: LeaveQuota[] = [
  { role: 'Employee',  substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Manager',   substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Executive', substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
  { role: 'Director',  substitute: 12, paid: 15, unpaid: 0, medical: 8, half_day: 10 },
];

const defaultHolidays: Holiday[] = [];

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

const sectionIds = ['leave', 'leave_rollover', 'financial_year', 'working_hours', 'holidays', 'tasks', 'overtime', 'shifts'] as const;

const ROLLOVER_REMINDER_TITLE = '⚠️ Year-end leave rollover — open Director Settings and click Start leave rollover';
type SectionId = typeof sectionIds[number];

export default function DirectorSettings() {
  const { user, effectiveUserId } = useAuth();
  const supabase = createClient();

  const [openSection, setOpenSection] = useState<SectionId>('leave');
  const [leaveQuotas, setLeaveQuotas] = useState<LeaveQuota[]>(defaultLeaveQuotas);
  const [holidays, setHolidays] = useState<Holiday[]>(defaultHolidays);
  const [taskLimits, setTaskLimits] = useState<TaskLimits>({ maxConcurrent: 5, maxOverdueDays: 3, dailyLimit: 8 });
  const [overtime, setOvertime] = useState<OvertimeThresholds>({ dailyHours: 2, weeklyHours: 10, monthlyHours: 40 });
  const [shifts, setShifts] = useState<ShiftConfig>({
    morningStart: '09:00', morningEnd: '18:00',
    eveningStart: '14:00', eveningEnd: '23:00',
    nightStart: '22:00', nightEnd: '07:00',
  });
  const [workingHours, setWorkingHours] = useState<WorkingHoursConfig>(defaultWorkingHours);
  const [financialYear, setFinancialYear] = useState<FinancialYearConfig>(defaultFinancialYear);
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '', type: 'national' as Holiday['type'] });
  const [saving, setSaving] = useState<SectionId | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

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
          if (row.setting_key === 'leave_quotas_by_fy' && row.setting_value) {
            const qData = row.setting_value;
            setLeaveQuotas([
              { role: 'Employee',  ...defaultLeaveQuotas[0], ...(qData.employee  || {}) },
              { role: 'Manager',   ...defaultLeaveQuotas[1], ...(qData.manager   || {}) },
              { role: 'Executive', ...defaultLeaveQuotas[2], ...(qData.executive || {}) },
              { role: 'Director',  ...defaultLeaveQuotas[3], ...(qData.director  || {}) },
            ]);
          }
        });
      }
    } catch {}
    setLoadingSettings(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSetting = async (key: string, value: object) => {
    const uid = effectiveUserId;
    const { error } = await supabase
      .from('director_settings')
      .upsert({ setting_key: key, setting_value: value, updated_by: uid }, { onConflict: 'setting_key' });
    if (error) {
      // Retry without updated_by in case column doesn't exist or RLS issue
      const { error: error2 } = await supabase
        .from('director_settings')
        .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
      if (error2) throw error2;
    }
  };

  // Adds one yearly, urgent calendar event on the next 31 March so the director
  // remembers to run the leave rollover. Created once per director.
  const ensureRolloverReminder = async () => {
    if (!effectiveUserId) return;
    const { data: existing } = await supabase
      .from('calendar_events')
      .select('id')
      .eq('created_by', effectiveUserId)
      .eq('title', ROLLOVER_REMINDER_TITLE)
      .eq('recurring', 'yearly')
      .limit(1);
    if (existing && existing.length > 0) return;

    const { data: me } = await supabase.from('user_profiles').select('firm_id').eq('id', effectiveUserId).maybeSingle();
    const now = new Date();
    const closeThisYear = new Date(now.getFullYear(), 2, 31, 23, 59);
    const year = now > closeThisYear ? now.getFullYear() + 1 : now.getFullYear();

    const { error } = await supabase.from('calendar_events').insert({
      title: ROLLOVER_REMINDER_TITLE,
      description: 'Financial year closes today. Open Director Settings → Leave Rollover and click "Start leave rollover" to carry unused leave into the next year.',
      event_date: `${year}-03-31`,
      firm_id: me?.firm_id ?? null,
      start_time: null,
      end_time: null,
      event_type: 'task',
      recurring: 'yearly',
      department: 'All',
      priority: 'urgent',
      director_only: true,
      created_by: effectiveUserId,
    });
    if (error) console.warn('Could not create leave rollover reminder:', error.message);
  };

  useEffect(() => {
    if (effectiveUserId) ensureRolloverReminder();
  }, [effectiveUserId]);

  const [rollingOver, setRollingOver] = useState(false);

  const handleLeaveRollover = async () => {
    if (!effectiveUserId) return;
    const fromFY = getFiscalYear();
    const toFY = fromFY + 1;
    const ok = window.confirm(
      `Carry all unused leave from FY ${fromFY}-${fromFY + 1} into FY ${toFY}-${toFY + 1} for every employee?\n\n` +
      `There is no cap and no expiry. Run it after the year closes so the figures are final. ` +
      `Running it again only recalculates; nothing is counted twice.`
    );
    if (!ok) return;

    setRollingOver(true);
    try {
      // Same scope as Leave Admin: firms this director can see for leave, else own firm.
      const { data: visibleIds, error: firmErr } = await supabase.rpc('get_visible_firm_ids', {
        p_user_id: effectiveUserId,
        p_module: 'leave',
      });
      let firmIds: string[] = !firmErr && visibleIds?.length ? (visibleIds as string[]) : [];
      if (firmIds.length === 0) {
        const { data: me } = await supabase.from('user_profiles').select('firm_id').eq('id', effectiveUserId).maybeSingle();
        if (me?.firm_id) firmIds = [me.firm_id as string];
      }

      const res = await rolloverLeave(supabase, { fromFY, toFY, firmIds });
      if (res.rowsWritten === 0) {
        toast.info(`No FY ${fromFY}-${fromFY + 1} balances found to carry forward`);
      } else {
        toast.success(
          `Leave rolled over for ${res.employeesAffected} employees — ${res.daysCarried} days carried into FY ${toFY}-${toFY + 1}`
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Leave rollover failed');
    } finally {
      setRollingOver(false);
    }
  };

  const handleSave = async (section: SectionId) => {
    setSaving(section);
    try {
      if (section === 'working_hours') {
        await saveSetting('working_hours', workingHours);
      } else if (section === 'financial_year') {
        await saveSetting('financial_year', financialYear);
      } else if (section === 'leave') {
        const quotaMap: Record<string, object> = {};
        leaveQuotas.forEach((q) => { quotaMap[q.role.toLowerCase()] = { substitute: q.substitute, paid: q.paid, unpaid: q.unpaid, medical: q.medical, half_day: q.half_day }; });
        await saveSetting('leave_quotas_by_fy', quotaMap);
      } else if (section === 'tasks') {
        await saveSetting('task_limits', taskLimits);
      } else if (section === 'overtime') {
        await saveSetting('overtime_thresholds', overtime);
      } else if (section === 'shifts') {
        await saveSetting('shift_defaults', shifts);
      } else if (section === 'holidays') {
        await saveSetting('holidays_list', holidays as unknown as object);
      }
      toast.success(`${section.replace(/_/g, ' ')} settings saved`, { duration: 2000 });
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

  const typeColors: Record<Holiday['type'], string> = {
    national: 'bg-blue-100 text-blue-700',
    regional: 'bg-purple-100 text-purple-700',
    company: 'bg-amber-100 text-amber-700',
  };

  const sections: { id: SectionId; label: string; icon: React.ElementType; desc: string }[] = [
    { id: 'leave',          label: 'Leave Quotas (per FY)',    icon: Calendar, desc: 'Annual leave days per role per financial year' },
    { id: 'leave_rollover', label: 'Leave Rollover (year-end)', icon: Calendar, desc: 'Carry unused leave into the next financial year — no cap, no expiry' },
    { id: 'financial_year', label: 'Financial Year',           icon: Calendar, desc: 'Set the financial year start/end dates' },
    { id: 'working_hours',  label: 'Working Hours',            icon: Clock,    desc: 'Standard working hours, breaks & overtime thresholds' },
    { id: 'holidays',       label: 'Public Holidays (legacy)', icon: Calendar, desc: 'Quick holiday list — use Holiday Management page for full control' },
    { id: 'tasks',          label: 'Task Limits',              icon: Briefcase,desc: 'Concurrent & daily task caps' },
    { id: 'overtime',       label: 'Overtime Thresholds',      icon: Clock,    desc: 'Daily, weekly & monthly limits' },
    { id: 'shifts',         label: 'Shift Defaults',           icon: Clock,    desc: 'Working hours per shift type' },
  ];

  if (loadingSettings) {
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
          <Shield size={20} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Director Settings</h1>
          <p className="text-sm text-slate-500">Company-wide configuration · Director access only</p>
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
                onClick={() => setOpenSection(isOpen ? sec.id : sec.id)}
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
                  {/* Leave Quotas */}
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
                                <td className="py-3 pr-4">
                                  <span className="font-semibold text-slate-800">{q.role}</span>
                                </td>
                                {(['substitute', 'paid', 'unpaid', 'medical', 'half_day'] as const).map((field) => (
                                  <td key={field} className="py-3 px-2 text-center">
                                    <input
                                      type="number"
                                      min={0}
                                      max={365}
                                      value={q[field]}
                                      onChange={(e) => updateLeaveQuota(i, field, parseInt(e.target.value) || 0)}
                                      className="w-14 text-center border border-slate-200 rounded-lg px-1 py-1.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                                    />
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
                        <button
                          onClick={() => handleSave('leave')}
                          disabled={saving === 'leave'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          {saving === 'leave' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'leave' ? 'Saving…' : 'Save Leave Quotas'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Financial Year */}
                  {sec.id === 'financial_year' && (
                    <div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">FY Start Month</p>
                          <select
                            value={financialYear.start_month}
                            onChange={(e) => setFinancialYear({ ...financialYear, start_month: Number(e.target.value) })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          >
                            {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                              <option key={i} value={i + 1}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">FY Start Day</p>
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={financialYear.start_day}
                            onChange={(e) => setFinancialYear({ ...financialYear, start_day: Number(e.target.value) })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Current FY Start Date</p>
                          <input
                            type="date"
                            value={financialYear.current_fy_start}
                            onChange={(e) => setFinancialYear({ ...financialYear, current_fy_start: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Current FY End Date</p>
                          <input
                            type="date"
                            value={financialYear.current_fy_end}
                            onChange={(e) => setFinancialYear({ ...financialYear, current_fy_end: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleSave('financial_year')}
                          disabled={saving === 'financial_year'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          {saving === 'financial_year' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'financial_year' ? 'Saving…' : 'Save Financial Year'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Working Hours */}
                  {sec.id === 'working_hours' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Standard Start Time</p>
                          <input
                            type="time"
                            value={workingHours.standard_start}
                            onChange={(e) => setWorkingHours({ ...workingHours, standard_start: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                          />
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <p className="text-xs font-semibold text-slate-600 mb-2">Standard End Time</p>
                          <input
                            type="time"
                            value={workingHours.standard_end}
                            onChange={(e) => setWorkingHours({ ...workingHours, standard_end: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                          />
                        </div>
                      </div>
                      {[
                        { key: 'break_minutes',              label: 'Break Duration (minutes)',           desc: 'Total break time per day',                min: 0,  max: 120 },
                        { key: 'daily_hours',                label: 'Standard Daily Hours',               desc: 'Expected working hours per day',          min: 1,  max: 24  },
                        { key: 'weekly_hours',               label: 'Standard Weekly Hours',              desc: 'Expected working hours per week',         min: 1,  max: 80  },
                        { key: 'overtime_threshold_daily',   label: 'Daily Overtime Threshold (hours)',   desc: 'Hours beyond shift end before OT kicks in',min: 0, max: 8   },
                        { key: 'overtime_threshold_weekly',  label: 'Weekly Overtime Cap (hours)',        desc: 'Max overtime hours allowed per week',     min: 0,  max: 40  },
                        { key: 'overtime_threshold_monthly', label: 'Monthly Overtime Cap (hours)',       desc: 'Max overtime hours allowed per month',    min: 0,  max: 160 },
                      ].map((field) => (
                        <div key={field.key} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{field.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{field.desc}</p>
                          </div>
                          <input
                            type="number"
                            min={field.min}
                            max={field.max}
                            value={workingHours[field.key as keyof WorkingHoursConfig] as number}
                            onChange={(e) => setWorkingHours({ ...workingHours, [field.key]: parseInt(e.target.value) || 0 })}
                            className="w-20 text-center border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleSave('working_hours')}
                          disabled={saving === 'working_hours'}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          {saving === 'working_hours' ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                          {saving === 'working_hours' ? 'Saving…' : 'Save Working Hours'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Holidays (legacy) */}
                  {sec.id === 'holidays' && (
                    <div>
                      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                        <AlertTriangle size={13} className="text-blue-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">For full holiday management with CSV import and Sunday overtime, use the <strong>Holiday Management</strong> page in the sidebar.</p>
                      </div>
                      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                        {holidays.map((h) => (
                          <div key={h.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">{h.name}</p>
                              <p className="text-xs text-slate-500">{new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
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
                          <input
                            type="text"
                            placeholder="Holiday name"
                            value={newHoliday.name}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                          <input
                            type="date"
                            value={newHoliday.date}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                          <select
                            value={newHoliday.type}
                            onChange={(e) => setNewHoliday((p) => ({ ...p, type: e.target.value as Holiday['type'] }))}
                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          >
                            <option value="national">National</option>
                            <option value="regional">Regional</option>
                            <option value="company">Company</option>
                          </select>
                          <button
                            onClick={addHoliday}
                            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
                          >
                            <Plus size={14} /> Add
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Task Limits */}
                  {sec.id === 'tasks' && (
                    <div className="space-y-4">
                      {[
                        { key: 'maxConcurrent', label: 'Max Concurrent Tasks per Employee', desc: 'Maximum tasks an employee can have active at once', min: 1, max: 20 },
                        { key: 'maxOverdueDays', label: 'Overdue Alert Threshold (days)', desc: 'Flag tasks as overdue after this many days past deadline', min: 1, max: 30 },
                        { key: 'dailyLimit', label: 'Daily Task Assignment Limit', desc: 'Max new tasks that can be assigned to one employee per day', min: 1, max: 20 },
                      ].map((field) => (
                        <div key={field.key} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{field.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{field.desc}</p>
                          </div>
                          <input
                            type="number"
                            min={field.min}
                            max={field.max}
                            value={taskLimits[field.key as keyof TaskLimits]}
                            onChange={(e) => setTaskLimits((p) => ({ ...p, [field.key]: parseInt(e.target.value) || field.min }))}
                            className="w-20 text-center border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <button
                          onClick={() => { toast.success('Task limits saved'); }}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          <Save size={14} /> Save Task Limits
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Overtime */}
                  {sec.id === 'overtime' && (
                    <div className="space-y-4">
                      {[
                        { key: 'dailyHours', label: 'Daily Overtime Threshold (hours)', desc: 'Hours beyond shift end before overtime kicks in', min: 0, max: 8 },
                        { key: 'weeklyHours', label: 'Weekly Overtime Cap (hours)', desc: 'Maximum overtime hours allowed per week', min: 0, max: 40 },
                        { key: 'monthlyHours', label: 'Monthly Overtime Cap (hours)', desc: 'Maximum overtime hours allowed per month', min: 0, max: 160 },
                      ].map((field) => (
                        <div key={field.key} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{field.label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{field.desc}</p>
                          </div>
                          <input
                            type="number"
                            min={field.min}
                            max={field.max}
                            value={overtime[field.key as keyof OvertimeThresholds]}
                            onChange={(e) => setOvertime((p) => ({ ...p, [field.key]: parseInt(e.target.value) || 0 }))}
                            className="w-20 text-center border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                          />
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <button
                          onClick={() => { toast.success('Overtime thresholds saved'); }}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          <Save size={14} /> Save Overtime Thresholds
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Leave Rollover */}
                  {sec.id === 'leave_rollover' && (
                    <div className="space-y-4">
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
                        <p className="font-semibold text-slate-800">
                          Carry FY {getFiscalYear()}-{getFiscalYear() + 1} unused leave into FY {getFiscalYear() + 1}-{getFiscalYear() + 2}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Each employee&apos;s remaining days (total − used) move into the next year on top of their entitlement.
                          No cap and no expiry. Run after the year closes (after 31 March) so the figures are final.
                          Running it again only recalculates, so nothing is counted twice.
                        </p>
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={handleLeaveRollover}
                          disabled={rollingOver}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          {rollingOver ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          {rollingOver ? 'Rolling over…' : 'Start leave rollover'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Shifts */}
                  {sec.id === 'shifts' && (
                    <div className="space-y-4">
                      {[
                        { label: 'Morning Shift', startKey: 'morningStart', endKey: 'morningEnd', color: 'bg-amber-50 border-amber-200' },
                        { label: 'Evening Shift', startKey: 'eveningStart', endKey: 'eveningEnd', color: 'bg-blue-50 border-blue-200' },
                        { label: 'Night Shift',   startKey: 'nightStart',   endKey: 'nightEnd',   color: 'bg-slate-800 border-slate-700' },
                      ].map((shift) => (
                        <div key={shift.label} className={`p-4 rounded-xl border ${shift.color}`}>
                          <p className={`text-sm font-semibold mb-3 ${shift.label === 'Night Shift' ? 'text-white' : 'text-slate-800'}`}>{shift.label}</p>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <label className={`text-xs font-medium block mb-1 ${shift.label === 'Night Shift' ? 'text-slate-400' : 'text-slate-500'}`}>Start Time</label>
                              <input
                                type="time"
                                value={shifts[shift.startKey as keyof ShiftConfig]}
                                onChange={(e) => setShifts((p) => ({ ...p, [shift.startKey]: e.target.value }))}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                              />
                            </div>
                            <span className={`text-sm mt-5 ${shift.label === 'Night Shift' ? 'text-slate-400' : 'text-slate-400'}`}>→</span>
                            <div>
                              <label className={`text-xs font-medium block mb-1 ${shift.label === 'Night Shift' ? 'text-slate-400' : 'text-slate-500'}`}>End Time</label>
                              <input
                                type="time"
                                value={shifts[shift.endKey as keyof ShiftConfig]}
                                onChange={(e) => setShifts((p) => ({ ...p, [shift.endKey]: e.target.value }))}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-end">
                        <button
                          onClick={() => { toast.success('Shift defaults saved'); }}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                        >
                          <Save size={14} /> Save Shift Defaults
                        </button>
                      </div>
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
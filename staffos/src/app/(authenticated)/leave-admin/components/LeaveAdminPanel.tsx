'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Settings, RefreshCw, Users, Building2, Plus, X, Save, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import FirmFilterTabs from '@/components/FirmFilterTabs';
import { toast, Toaster } from 'sonner';
import Icon from '@/components/ui/AppIcon';


interface LeaveBalance {
  id: string;
  user_id: string;
  leave_type: string;
  fiscal_year: number;
  total_days: number;
  used_days: number;
  carry_forward_days: number;
  firm_id: string | null;
  user_profiles?: { full_name: string; department: string; role: string };
}

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  holiday_type: string;
  firm_id: string | null;
}

interface UserProfile { id: string; full_name: string; department: string; role: string; firm_id: string | null; }

interface FirmOption { id: string; name: string; code: string; }

// Used only when the caller can see no firms at all, so every "in (...)" filter stays valid SQL
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const LEAVE_TYPES = [
  { key: 'substitute', label: 'Substitute Leave', defaultDays: 12 },
  { key: 'paid', label: 'Paid Leave', defaultDays: 15 },
  { key: 'medical', label: 'Medical Leave', defaultDays: 8 },
  { key: 'half_day', label: 'Half Day', defaultDays: 10 },
  { key: 'unpaid', label: 'Unpaid Leave', defaultDays: 0 },
];

function getFiscalYear(date: Date = new Date()): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export default function LeaveAdminPanel() {
  const { effectiveUserId } = useAuth();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'balances' | 'holidays' | 'settings'>('balances');
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [firmOptions, setFirmOptions] = useState<FirmOption[]>([]);
  const [myFirmId, setMyFirmId] = useState<string | null>(null);
  const [firmFilter, setFirmFilter] = useState<'all' | string>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFY, setSelectedFY] = useState(getFiscalYear());
  const [deptFilter, setDeptFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  // Entitlement settings
  const [entitlements, setEntitlements] = useState<Record<string, number>>(
    Object.fromEntries(LEAVE_TYPES.map(lt => [lt.key, lt.defaultDays]))
  );
  const [carryForwardEnabled, setCarryForwardEnabled] = useState(false);
  const [carryForwardMax, setCarryForwardMax] = useState(5);
  const [carryForwardExpiry, setCarryForwardExpiry] = useState(90); // days

  // Holiday form
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '', holiday_type: 'national', is_optional: false });
  const [savingHoliday, setSavingHoliday] = useState(false);

  // Employees and holidays in the firm currently selected in the firm tabs ('all' = every visible firm)
  const firmUsers = firmFilter === 'all' ? users : users.filter(u => u.firm_id === firmFilter);
  const scopedHolidays = firmFilter === 'all' ? holidays : holidays.filter(h => h.firm_id === firmFilter);
  const departments = Array.from(new Set(firmUsers.map(u => u.department).filter(Boolean))).sort();

  const firmNameById = (id: string | null | undefined) => firmOptions.find(f => f.id === id)?.name ?? '—';
  const firmNameOfUser = (uid: string) => firmNameById(users.find(u => u.id === uid)?.firm_id);

  const fetchData = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      // Own firm, plus every firm whose LEAVE data is shared with us
      // (or that we see as a holding-firm director). Must use module 'leave':
      // rules shared for other modules, and the 'all' rule, do not cover leave.
      const { data: me } = await supabase.from('user_profiles').select('firm_id').eq('id', effectiveUserId).maybeSingle();
      const ownFirmId: string | null = me?.firm_id ?? null;
      setMyFirmId(ownFirmId);

      const { data: sharedIds, error: firmErr } = await supabase.rpc('get_visible_firm_ids', {
        p_user_id: effectiveUserId,
        p_module: 'leave',
      });
      const firmIds: string[] = !firmErr && sharedIds?.length
        ? (sharedIds as string[])
        : (ownFirmId ? [ownFirmId] : []);
      const scopeIds = firmIds.length ? firmIds : [NIL_UUID];

      const [firmsRes, usersRes, balancesRes, holidaysRes, settingsRes] = await Promise.all([
        supabase.from('firms').select('id, name, code').in('id', scopeIds).order('name'),
        supabase.from('user_profiles').select('id, full_name, department, role, firm_id').in('firm_id', scopeIds).order('full_name'),
        supabase.from('leave_balances')
          .select('*, user_profiles(full_name, department, role)')
          .eq('fiscal_year', selectedFY)
          .in('firm_id', scopeIds)
          .order('leave_type'),
        supabase.from('company_holidays').select('*').in('firm_id', scopeIds).order('holiday_date'),
        supabase.from('director_settings').select('setting_key, setting_value'),
      ]);

      if (firmsRes.data) setFirmOptions(firmsRes.data as FirmOption[]);
      if (usersRes.data) setUsers(usersRes.data as UserProfile[]);
      if (balancesRes.data) setBalances(balancesRes.data as LeaveBalance[]);
      if (holidaysRes.data) setHolidays(holidaysRes.data as Holiday[]);

      if (settingsRes.data) {
        // director_settings is a key-value store: { setting_key, setting_value }
        const settingsMap: Record<string, any> = {};
        settingsRes.data.forEach((row: any) => {
          settingsMap[row.setting_key] = row.setting_value;
        });

        // Load leave quotas from leave_quotas_by_fy key
        const fy = settingsMap['leave_quotas_by_fy'];
        if (fy) {
          const fyKey = `${selectedFY}-${selectedFY + 1}`;
          const quotas = fy[fyKey] || fy[String(selectedFY)];
          if (quotas) {
            const newEnt: Record<string, number> = { ...entitlements };
            LEAVE_TYPES.forEach(lt => {
              if (quotas[lt.key] !== undefined) newEnt[lt.key] = quotas[lt.key];
            });
            setEntitlements(newEnt);
          }
        }

        // Load carry forward settings from carry_forward_settings key
        const cf = settingsMap['carry_forward_settings'];
        if (cf) {
          setCarryForwardEnabled(cf.enabled ?? false);
          setCarryForwardMax(cf.max_days ?? 5);
          setCarryForwardExpiry(cf.expiry_days ?? 90);
        }
      }
    } catch (err: any) {
      toast.error('Failed to load leave admin data');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, selectedFY]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveEntitlements = async () => {
    setSaving(true);
    try {
      const fyKey = `${selectedFY}-${selectedFY + 1}`;

      // Save leave quotas using key-value upsert pattern
      const { error: quotaError } = await supabase.from('director_settings')
        .upsert(
          { setting_key: 'leave_quotas_by_fy', setting_value: { [fyKey]: entitlements } },
          { onConflict: 'setting_key' }
        );
      if (quotaError) throw quotaError;

      // Save carry forward settings using key-value upsert pattern
      const { error: cfError } = await supabase.from('director_settings')
        .upsert(
          {
            setting_key: 'carry_forward_settings',
            setting_value: {
              enabled: carryForwardEnabled,
              max_days: carryForwardMax,
              expiry_days: carryForwardExpiry,
            },
          },
          { onConflict: 'setting_key' }
        );
      if (cfError) throw cfError;

      toast.success('Leave entitlements saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save entitlements');
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculateBalances = async (scope: 'all' | 'dept' | 'user') => {
    setSaving(true);
    try {
      // Fetch all users in scope (within the selected firm tab)
      let targetUsers = firmUsers;
      if (scope === 'dept' && deptFilter !== 'all') targetUsers = firmUsers.filter(u => u.department === deptFilter);
      if (scope === 'user' && userFilter !== 'all') targetUsers = firmUsers.filter(u => u.id === userFilter);

      let upserted = 0;
      for (const u of targetUsers) {
        for (const lt of LEAVE_TYPES) {
          const quota = entitlements[lt.key] ?? lt.defaultDays;
          const existing = balances.find(b => b.user_id === u.id && b.leave_type === lt.key);
          const usedDays = existing?.used_days ?? 0;
          const cfDays = carryForwardEnabled ? Math.min(existing?.carry_forward_days ?? 0, carryForwardMax) : 0;

          const { error } = await supabase.from('leave_balances').upsert({
            user_id: u.id,
            firm_id: u.firm_id ?? myFirmId, // keeps the row visible to firm-scoped queries
            leave_type: lt.key,
            fiscal_year: selectedFY,
            total_days: quota + cfDays,
            used_days: usedDays,
            carry_forward_days: cfDays,
          }, { onConflict: 'user_id,leave_type,fiscal_year' });
          if (error) throw error;
          upserted++;
        }
      }
      toast.success(`Recalculated balances for ${targetUsers.length} employees (${upserted} records)`);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to recalculate balances');
    } finally {
      setSaving(false);
    }
  };

  const handleAddHoliday = async () => {
    if (!holidayForm.name.trim() || !holidayForm.date) { toast.error('Name and date are required'); return; }
    // Holiday goes to the firm tab you have selected, or to your own firm when the tab is "All"
    const targetFirm = firmFilter !== 'all' ? firmFilter : myFirmId;
    if (!targetFirm) { toast.error('Could not determine which firm this holiday belongs to'); return; }
    setSavingHoliday(true);
    try {
      const { error } = await supabase.from('company_holidays').insert({
        name: holidayForm.name,
        holiday_date: holidayForm.date,
        holiday_type: holidayForm.holiday_type,
        firm_id: targetFirm,
      });
      if (error) throw error;
      toast.success('Holiday added');
      setHolidayForm({ name: '', date: '', holiday_type: 'national', is_optional: false });
      setShowHolidayForm(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add holiday');
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    try {
      const { error } = await supabase.from('company_holidays').delete().eq('id', id);
      if (error) throw error;
      setHolidays(prev => prev.filter(h => h.id !== id));
      toast.success('Holiday removed');
    } catch (err: any) {
      toast.error('Failed to remove holiday');
    }
  };

  const filteredBalances = balances.filter(b => {
    if (firmFilter !== 'all' && b.firm_id !== firmFilter) return false;
    if (deptFilter !== 'all' && (b.user_profiles as any)?.department !== deptFilter) return false;
    if (userFilter !== 'all' && b.user_id !== userFilter) return false;
    return true;
  });

  // Group balances by user
  const balancesByUser = filteredBalances.reduce((acc, b) => {
    const uid = b.user_id;
    if (!acc[uid]) acc[uid] = { user: b.user_profiles, balances: [] };
    acc[uid].balances.push(b);
    return acc;
  }, {} as Record<string, { user: any; balances: LeaveBalance[] }>);

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <CalendarDays size={16} className="text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Leave Administration</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage leave entitlements, balances, holidays and carry-forward rules</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500">
            <RefreshCw size={16} />
          </button>
          <select value={selectedFY} onChange={e => setSelectedFY(Number(e.target.value))}
            className="text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {[getFiscalYear() - 1, getFiscalYear(), getFiscalYear() + 1].map(fy => (
              <option key={fy} value={fy}>FY {fy}-{fy + 1}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {[
          { id: 'balances', label: 'Leave Balances', icon: Users },
          { id: 'holidays', label: 'Holiday Configuration', icon: CalendarDays },
          { id: 'settings', label: 'Entitlement Rules', icon: Settings },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl border transition-colors ${activeTab === tab.id ? 'bg-amber-600 text-white border-amber-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-300'}`}>
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Firm filter: shows only when you can see more than one firm (own + shared) */}
      {firmOptions.length > 1 && (
        <div className="mb-4">
          <FirmFilterTabs firms={firmOptions} selectedFirmId={firmFilter} onSelect={(id) => { setFirmFilter(id); setDeptFilter('all'); setUserFilter('all'); }} />
        </div>
      )}

      {/* Leave Balances Tab */}
      {activeTab === 'balances' && (
        <div>
          {/* Filters + Recalculate */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 mb-5 shadow-sm">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Department</label>
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                  className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                  <option value="all">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Employee</label>
                <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
                  className="text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                  <option value="all">All Employees</option>
                  {firmUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 ml-auto flex-wrap">
                <button onClick={() => handleRecalculateBalances('user')} disabled={saving || userFilter === 'all'}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 transition-colors disabled:opacity-40">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Recalculate Employee
                </button>
                <button onClick={() => handleRecalculateBalances('dept')} disabled={saving || deptFilter === 'all'}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 transition-colors disabled:opacity-40">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />} Recalculate Dept
                </button>
                <button onClick={() => handleRecalculateBalances('all')} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-40">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Recalculate All
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : Object.keys(balancesByUser).length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 py-16 text-center">
              <CalendarDays size={40} className="text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-500">No leave balances found for FY {selectedFY}-{selectedFY + 1}</p>
              <p className="text-xs text-slate-400 mt-1">Click "Recalculate All" to seed balances from entitlement rules</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(balancesByUser).map(([uid, entry]) => {
                const user = (entry as { user: any; balances: LeaveBalance[] }).user;
                const ubs = (entry as { user: any; balances: LeaveBalance[] }).balances;
                const firmName = firmNameOfUser(uid);
                return (
                <div key={uid} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm">
                      {user?.full_name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{user?.full_name || 'Unknown'}</p>
                      <p className="text-xs text-slate-500">
                        {user?.department || '—'} · {user?.role || '—'}{firmFilter === 'all' && firmName !== '—' ? ` · ${firmName}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-0 divide-x divide-y divide-slate-100 dark:divide-slate-700">
                    {ubs.map(b => {
                      const available = b.total_days - b.used_days;
                      const pct = b.total_days > 0 ? Math.round((b.used_days / b.total_days) * 100) : 0;
                      return (
                        <div key={b.id} className="p-3">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{b.leave_type.replace('_', ' ')}</p>
                          <div className="flex items-baseline gap-1 mb-1">
                            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">{available}</span>
                            <span className="text-xs text-slate-400">/ {b.total_days}</span>
                          </div>
                          <div className="w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{b.used_days} used · {b.carry_forward_days || 0} CF</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Holidays Tab */}
      {activeTab === 'holidays' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">{scopedHolidays.length} holidays configured</p>
            <button onClick={() => setShowHolidayForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors">
              <Plus size={14} /> Add Holiday
            </button>
          </div>

          {showHolidayForm && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 mb-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Add New Holiday</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Holiday Name *</label>
                  <input value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Diwali" className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Date *</label>
                  <input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Type</label>
                  <select value={holidayForm.holiday_type} onChange={e => setHolidayForm(f => ({ ...f, holiday_type: e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                    <option value="national">National</option>
                    <option value="regional">Regional</option>
                    <option value="company">Company</option>
                    <option value="optional">Optional</option>
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={holidayForm.is_optional} onChange={e => setHolidayForm(f => ({ ...f, is_optional: e.target.checked }))}
                      className="rounded" />
                    Optional
                  </label>
                  <button onClick={handleAddHoliday} disabled={savingHoliday}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors disabled:opacity-60 ml-auto">
                    {savingHoliday ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                  </button>
                  <button onClick={() => setShowHolidayForm(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {scopedHolidays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <CalendarDays size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No holidays configured</p>
                <p className="text-xs mt-1">Add holidays to sync with employee leave calendars</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 dark:bg-slate-700/50">
                  {['Date', 'Holiday Name', 'Firm', 'Type', 'Optional', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {scopedHolidays.map(h => (
                    <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {new Date(h.holiday_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{h.name}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{firmNameById(h.firm_id)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${h.holiday_type === 'national' ? 'bg-blue-100 text-blue-700' : h.holiday_type === 'company' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                          {h.holiday_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{(h as any).is_optional ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => handleDeleteHoliday(h.id)} className="text-red-400 hover:text-red-600 transition-colors">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Entitlement Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-5">
          {/* Leave Entitlements */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Leave Entitlement Rules — FY {selectedFY}-{selectedFY + 1}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {LEAVE_TYPES.map(lt => (
                <div key={lt.key} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{lt.label}</p>
                    <p className="text-xs text-slate-400">Days per fiscal year</p>
                  </div>
                  <input type="number" min="0" max="365" value={entitlements[lt.key] ?? lt.defaultDays}
                    onChange={e => setEntitlements(prev => ({ ...prev, [lt.key]: Number(e.target.value) }))}
                    className="w-16 text-center text-sm font-bold border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                </div>
              ))}
            </div>
          </div>

          {/* Carry Forward Rules */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">Carry Forward Rules</h3>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={carryForwardEnabled} onChange={e => setCarryForwardEnabled(e.target.checked)}
                  className="w-4 h-4 rounded" />
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Enable Carry Forward</p>
                  <p className="text-xs text-slate-400">Allow unused leave to carry forward to next fiscal year</p>
                </div>
              </label>
              {carryForwardEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Maximum Carry Forward Days</label>
                    <input type="number" min="0" max="30" value={carryForwardMax} onChange={e => setCarryForwardMax(Number(e.target.value))}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Carry Forward Expiry (days)</label>
                    <input type="number" min="0" max="365" value={carryForwardExpiry} onChange={e => setCarryForwardExpiry(Number(e.target.value))}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" />
                    <p className="text-xs text-slate-400 mt-0.5">Days after fiscal year start before CF expires</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveEntitlements} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Entitlement Rules
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
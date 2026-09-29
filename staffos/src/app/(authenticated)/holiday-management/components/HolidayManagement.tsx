'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CalendarDays, Plus, Trash2, Upload, Download, Search, Loader2, X, Sun, Globe, Building2, AlertCircle, CheckCircle2, Users, Clock } from 'lucide-react';
import { toast, Toaster } from 'sonner';

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  holiday_type: 'national' | 'regional' | 'company';
  fiscal_year: number;
  is_sunday_overtime: boolean;
  notes: string;
  created_at: string;
}

interface OvertimeEmployee {
  id: string;
  user_id: string;
  fiscal_year: number;
  is_active: boolean;
  notes: string;
  user_profiles?: { full_name: string; department: string; job_title: string };
}

interface UserProfile {
  id: string;
  full_name: string;
  department: string;
  job_title: string;
}

const typeConfig = {
  national: { label: 'National', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Globe },
  regional: { label: 'Regional', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Sun },
  company:  { label: 'Company',  color: 'bg-amber-100 text-amber-700 border-amber-200',  icon: Building2 },
};

function getFiscalYear(date: Date = new Date()): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

const CSV_TEMPLATE = `Holiday Name,Date (YYYY-MM-DD),Type (national/regional/company),Notes
Republic Day,2026-01-26,national,
Holi,2026-03-14,national,
Independence Day,2026-08-15,national,
Gandhi Jayanti,2026-10-02,national,
Diwali,2026-10-20,national,
Christmas,2026-12-25,national,
Company Foundation Day,2026-06-01,company,Annual celebration`;

export default function HolidayManagement() {
  const { user } = useAuth();
  const supabase = createClient();
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [overtimeEmployees, setOvertimeEmployees] = useState<OvertimeEmployee[]>([]);
  const [allEmployees, setAllEmployees] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'holidays' | 'overtime'>('holidays');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFY, setSelectedFY] = useState<number>(getFiscalYear());
  const [showAddModal, setShowAddModal] = useState(false);
  const [importPreview, setImportPreview] = useState<Omit<Holiday, 'id' | 'created_at'>[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importError, setImportError] = useState('');

  const [newHoliday, setNewHoliday] = useState({
    name: '',
    holiday_date: '',
    holiday_type: 'national' as Holiday['holiday_type'],
    notes: '',
    is_sunday_overtime: false,
  });

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('company_holidays')
        .select('*')
        .eq('fiscal_year', selectedFY)
        .order('holiday_date', { ascending: true });
      if (error) throw error;
      setHolidays(data || []);
    } catch (err: any) {
      toast.error('Failed to load holidays');
    } finally {
      setLoading(false);
    }
  }, [selectedFY]);

  const fetchOvertimeEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sunday_overtime_employees')
        .select('*, user_profiles!sunday_overtime_employees_user_id_fkey(full_name, department, job_title)')
        .eq('fiscal_year', selectedFY);
      if (error) throw error;
      setOvertimeEmployees(data || []);
    } catch {}
  }, [selectedFY]);

  const fetchAllEmployees = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, full_name, department, job_title')
        .eq('is_active', true)
        .order('full_name');
      setAllEmployees(data || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchHolidays();
    fetchOvertimeEmployees();
    fetchAllEmployees();
  }, [fetchHolidays, fetchOvertimeEmployees, fetchAllEmployees]);

  const handleAddHoliday = async () => {
    if (!newHoliday.name.trim() || !newHoliday.holiday_date) {
      toast.error('Please fill in holiday name and date');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('company_holidays').insert({
        name: newHoliday.name.trim(),
        holiday_date: newHoliday.holiday_date,
        holiday_type: newHoliday.holiday_type,
        notes: newHoliday.notes,
        is_sunday_overtime: newHoliday.is_sunday_overtime,
        fiscal_year: selectedFY,
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success('Holiday added');
      setShowAddModal(false);
      setNewHoliday({ name: '', holiday_date: '', holiday_type: 'national', notes: '', is_sunday_overtime: false });
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add holiday');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    try {
      const { error } = await supabase.from('company_holidays').delete().eq('id', id);
      if (error) throw error;
      toast.success('Holiday removed');
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete holiday');
    }
  };

  const parseCSV = (text: string): Omit<Holiday, 'id' | 'created_at'>[] => {
    const lines = text.trim().split('\n').filter(Boolean);
    const results: Omit<Holiday, 'id' | 'created_at'>[] = [];
    const dataLines = lines.slice(1);
    for (const line of dataLines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) continue;
      const [name, date, type, notes] = parts;
      if (!name || !date) continue;
      const validType = ['national', 'regional', 'company'].includes(type) ? type as Holiday['holiday_type'] : 'national';
      results.push({
        name,
        holiday_date: date,
        holiday_type: validType,
        fiscal_year: selectedFY,
        is_sunday_overtime: false,
        notes: notes || '',
      });
    }
    return results;
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setImportError('No valid rows found. Check the CSV format.');
          return;
        }
        setImportPreview(parsed);
        setShowImportModal(true);
      } catch {
        setImportError('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    if (importPreview.length === 0) return;
    setSaving(true);
    try {
      const rows = importPreview.map((h) => ({ ...h, created_by: user?.id }));
      const { error } = await supabase.from('company_holidays').upsert(rows, { onConflict: 'holiday_date' });
      if (error) throw error;
      toast.success(`${importPreview.length} holidays imported successfully`);
      setShowImportModal(false);
      setImportPreview([]);
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || 'Import failed');
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'holidays_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleOvertimeEmployee = async (empId: string) => {
    const existing = overtimeEmployees.find((o) => o.user_id === empId);
    try {
      if (existing) {
        const { error } = await supabase
          .from('sunday_overtime_employees')
          .update({ is_active: !existing.is_active })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sunday_overtime_employees').insert({
          user_id: empId,
          fiscal_year: selectedFY,
          is_active: true,
          created_by: user?.id,
        });
        if (error) throw error;
      }
      toast.success('Updated');
      fetchOvertimeEmployees();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    }
  };

  const filteredHolidays = holidays.filter((h) =>
    !searchQuery || h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const fyLabel = `FY ${selectedFY}-${String(selectedFY + 1).slice(2)}`;
  const fyOptions = [getFiscalYear() - 1, getFiscalYear(), getFiscalYear() + 1];

  const overtimeActiveIds = new Set(overtimeEmployees.filter((o) => o.is_active).map((o) => o.user_id));

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Holiday & Overtime Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage company holidays, Sundays, and overtime employees</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold text-slate-700"
          >
            {fyOptions.map((fy) => (
              <option key={fy} value={fy}>FY {fy}-{String(fy + 1).slice(2)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5 w-fit">
        <button
          onClick={() => setActiveTab('holidays')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${activeTab === 'holidays' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <CalendarDays size={14} /> Holidays ({holidays.length})
        </button>
        <button
          onClick={() => setActiveTab('overtime')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${activeTab === 'overtime' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Users size={14} /> Sunday Overtime ({overtimeActiveIds.size})
        </button>
      </div>

      {activeTab === 'holidays' && (
        <>
          {/* Sunday notice */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4">
            <Sun size={15} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-700 font-medium">
              <span className="font-bold">Sundays are always holidays</span> for all employees. Select employees who come in for Sunday overtime in the &quot;Sunday Overtime&quot; tab.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search holidays..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download size={13} /> Template
              </button>
              <button
                onClick={() => csvInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-xl hover:bg-violet-100 transition-colors"
              >
                <Upload size={13} /> Import CSV
              </button>
              <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add Holiday
              </button>
            </div>
          </div>

          {/* Holiday List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={22} className="animate-spin text-blue-500" />
              </div>
            ) : filteredHolidays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <CalendarDays size={36} className="mb-3 opacity-40" />
                <p className="text-sm font-semibold">No holidays for {fyLabel}</p>
                <p className="text-xs mt-1">Add holidays manually or import a CSV file</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredHolidays.map((h) => {
                  const tCfg = typeConfig[h.holiday_type];
                  const TypeIcon = tCfg.icon;
                  const dateObj = new Date(h.holiday_date + 'T00:00:00');
                  const isSunday = dateObj.getDay() === 0;
                  return (
                    <div key={h.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-slate-700 leading-none">{dateObj.toLocaleDateString('en-IN', { day: 'numeric' })}</span>
                        <span className="text-[9px] text-slate-500 uppercase">{dateObj.toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-slate-900">{h.name}</p>
                          {isSunday && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">Sunday</span>}
                        </div>
                        <p className="text-xs text-slate-500">{dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                        {h.notes && <p className="text-xs text-slate-400 mt-0.5">{h.notes}</p>}
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${tCfg.color}`}>
                        <TypeIcon size={10} /> {tCfg.label}
                      </span>
                      <button
                        onClick={() => handleDeleteHoliday(h.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={13} className="text-red-400 hover:text-red-600" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'overtime' && (
        <>
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <Clock size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700 font-medium">
              Employees marked here are scheduled for <span className="font-bold">Sunday overtime</span> for {fyLabel}. Sundays remain holidays for all other employees.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {allEmployees.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Users size={36} className="mb-3 opacity-40" />
                <p className="text-sm font-semibold">No employees found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {allEmployees.map((emp) => {
                  const isActive = overtimeActiveIds.has(emp.id);
                  return (
                    <div key={emp.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-blue-700">{emp.full_name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{emp.full_name}</p>
                        <p className="text-xs text-slate-500">{emp.job_title}{emp.department ? ` · ${emp.department}` : ''}</p>
                      </div>
                      <button
                        onClick={() => toggleOvertimeEmployee(emp.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' :'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {isActive ? <><CheckCircle2 size={12} /> Overtime</> : <><Plus size={12} /> Add Overtime</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Add Holiday Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Add Holiday</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Holiday Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  placeholder="e.g. Diwali"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={newHoliday.holiday_date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, holiday_date: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Type</label>
                <select
                  value={newHoliday.holiday_type}
                  onChange={(e) => setNewHoliday({ ...newHoliday, holiday_type: e.target.value as Holiday['holiday_type'] })}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                >
                  <option value="national">National</option>
                  <option value="regional">Regional</option>
                  <option value="company">Company</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes (optional)</label>
                <input
                  type="text"
                  value={newHoliday.notes}
                  onChange={(e) => setNewHoliday({ ...newHoliday, notes: e.target.value })}
                  placeholder="Any additional notes..."
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={handleAddHoliday}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add Holiday
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Import Preview</h2>
                <p className="text-xs text-slate-500 mt-0.5">{importPreview.length} holidays ready to import for {fyLabel}</p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportPreview([]); }} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {importError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  <AlertCircle size={13} className="text-red-600" />
                  <p className="text-xs text-red-700">{importError}</p>
                </div>
              )}
              <div className="space-y-2">
                {importPreview.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{h.name}</p>
                      <p className="text-xs text-slate-500">{h.holiday_date} · {h.holiday_type}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button onClick={() => { setShowImportModal(false); setImportPreview([]); }} className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import {importPreview.length} Holidays
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

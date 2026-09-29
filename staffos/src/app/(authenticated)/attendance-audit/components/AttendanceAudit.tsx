'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { AlertTriangle, MapPinOff, WifiOff, Download, RefreshCw, ChevronLeft, Calendar, Users, Clock, BarChart2 } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import Icon from '@/components/ui/AppIcon';

interface AuditEmployee {
  id: string;
  full_name: string;
  job_title: string;
  department: string;
}

interface AttendanceViolation {
  id: string;
  user_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: string;
  total_hours: number;
  violation_type: 'late_arrival' | 'early_departure' | 'absent' | 'missing_clockout';
  employee?: AuditEmployee;
}

interface OutOfRadiusEvent {
  id: string;
  user_id: string;
  work_date: string;
  distance_meters: number;
  allowed_radius_meters: number;
  recorded_at: string;
  employee?: AuditEmployee;
}

interface GPSDowntimeEvent {
  id: string;
  user_id: string;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  employee?: AuditEmployee;
}

interface LocationAlertRow {
  id: string;
  user_id: string;
  alert_type: string;
  message: string;
  resolved_at: string | null;
  created_at: string;
  employee?: AuditEmployee;
}

interface UserMonthlyHoursSummary {
  user_id: string;
  full_name: string;
  department: string;
  total_hours: number;
  overtime_hours: number;
  present_days: number;
  absent_days: number;
  late_days: number;
}

type TabId = 'violations' | 'out_of_radius' | 'gps_downtime' | 'monthly_hours';

const WORK_START_HOUR = 9; // 9:00 AM
const WORK_END_HOUR = 17;  // 5:00 PM

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(ts: string) {
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

const violationLabels: Record<AttendanceViolation['violation_type'], { label: string; color: string }> = {
  late_arrival:     { label: 'Late Arrival',      color: 'text-amber-700 bg-amber-50 border-amber-200' },
  early_departure:  { label: 'Early Departure',   color: 'text-orange-700 bg-orange-50 border-orange-200' },
  absent:           { label: 'Absent',             color: 'text-red-700 bg-red-50 border-red-200' },
  missing_clockout: { label: 'Missing Clock-Out',  color: 'text-rose-700 bg-rose-50 border-rose-200' },
};

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceAudit() {
  const { user, pinSession, effectiveUserId } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<TabId>('violations');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [employees, setEmployees] = useState<AuditEmployee[]>([]);
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [violations, setViolations] = useState<AttendanceViolation[]>([]);
  const [outOfRadius, setOutOfRadius] = useState<OutOfRadiusEvent[]>([]);
  const [gpsDowntime, setGpsDowntime] = useState<GPSDowntimeEvent[]>([]);
  const [locationAlerts, setLocationAlerts] = useState<LocationAlertRow[]>([]);
  const [userMonthlyHours, setUserMonthlyHours] = useState<UserMonthlyHoursSummary[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  const role = pinSession?.role || '';
  const isManagerOrDirector = role === 'director' || role === 'manager' || role === 'executive';

  useEffect(() => {
    if (!isManagerOrDirector) {
      router.replace('/employee-dashboard');
    }
  }, [isManagerOrDirector]);

  useEffect(() => {
    if (!isManagerOrDirector || !effectiveUserId) return;
    supabase.rpc('get_visible_firm_ids', { p_user_id: effectiveUserId, p_module: 'all' }).then(({ data: visibleFirmIds }) => {
      let query = supabase.from('user_profiles').select('id, full_name, job_title, department').order('full_name');
      if (visibleFirmIds) query = query.in('firm_id', visibleFirmIds);
      query.then(({ data }) => {
        if (data) setEmployees(data as AuditEmployee[]);
      });
    });
  }, [isManagerOrDirector, effectiveUserId]);

  const fetchData = useCallback(async () => {
    if (!isManagerOrDirector) return;
    setLoading(true);
    try {
      const empFilter = selectedEmployee !== 'all' ? selectedEmployee : null;
      // When no specific employee is picked, restrict to the (already
      // firm-scoped) employee roster rather than every user_id in the DB —
      // several of these tables (out_of_radius_events, location_alerts,
      // gps_downtime_events) don't carry their own firm_id, so scoping
      // through the roster is what actually prevents a manager at one firm
      // from seeing another firm's attendance violations.
      const visibleUserIds = employees.map((e) => e.id);

      // 1. Attendance violations — late, absent, missing clock-out
      let attQuery = supabase
        .from('attendance_records')
        .select('id, user_id, work_date, clock_in, clock_out, status, total_hours')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('work_date', { ascending: false });
      attQuery = empFilter ? attQuery.eq('user_id', empFilter) : attQuery.in('user_id', visibleUserIds);
      const { data: attData } = await attQuery;

      // 2. Out-of-radius events
      let oorQuery = supabase
        .from('out_of_radius_events')
        .select('id, user_id, work_date, distance_meters, allowed_radius_meters, recorded_at')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('recorded_at', { ascending: false });
      oorQuery = empFilter ? oorQuery.eq('user_id', empFilter) : oorQuery.in('user_id', visibleUserIds);
      const { data: oorData } = await oorQuery;

      // 3. GPS downtime (from location_alerts table — alert_type = 'location_off')
      let alertQuery = supabase
        .from('location_alerts')
        .select('id, user_id, alert_type, message, resolved_at, created_at')
        .eq('alert_type', 'location_off')
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false });
      alertQuery = empFilter ? alertQuery.eq('user_id', empFilter) : alertQuery.in('user_id', visibleUserIds);
      const { data: alertData } = await alertQuery;

      // 4. Also fetch gps_downtime_events if table exists
      let downtimeQuery = supabase
        .from('gps_downtime_events')
        .select('id, user_id, work_date, started_at, ended_at, duration_minutes')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('started_at', { ascending: false });
      downtimeQuery = empFilter ? downtimeQuery.eq('user_id', empFilter) : downtimeQuery.in('user_id', visibleUserIds);
      const { data: downtimeData } = await downtimeQuery;

      // Build employee map
      const empMap = new Map(employees.map((e) => [e.id, e]));

      // Process violations
      const vList: AttendanceViolation[] = [];
      (attData || []).forEach((rec: any) => {
        const emp = empMap.get(rec.user_id);
        // Absent
        if (rec.status === 'absent' || (!rec.clock_in && rec.status !== 'holiday' && rec.status !== 'weekend')) {
          vList.push({ ...rec, violation_type: 'absent', employee: emp });
          return;
        }
        // Late arrival (clock-in after 9:15 AM)
        if (rec.clock_in) {
          const ci = new Date(rec.clock_in);
          const lateThreshold = new Date(ci);
          lateThreshold.setHours(WORK_START_HOUR, 15, 0, 0);
          if (ci > lateThreshold) {
            vList.push({ ...rec, violation_type: 'late_arrival', employee: emp });
          }
        }
        // Missing clock-out (clocked in but no clock-out and work_date < today)
        if (rec.clock_in && !rec.clock_out && rec.work_date < new Date().toISOString().split('T')[0]) {
          vList.push({ ...rec, violation_type: 'missing_clockout', employee: emp });
        }
        // Early departure (clock-out before 4:45 PM)
        if (rec.clock_out) {
          const co = new Date(rec.clock_out);
          const earlyThreshold = new Date(co);
          earlyThreshold.setHours(WORK_END_HOUR - 1, 45, 0, 0);
          if (co < earlyThreshold && rec.status !== 'half_day') {
            vList.push({ ...rec, violation_type: 'early_departure', employee: emp });
          }
        }
      });
      setViolations(vList);

      // Process out-of-radius
      setOutOfRadius(
        (oorData || []).map((r: any) => ({ ...r, employee: empMap.get(r.user_id) }))
      );

      // Process GPS downtime — merge location_alerts + gps_downtime_events
      const downtimeRows: GPSDowntimeEvent[] = [
        ...(downtimeData || []).map((r: any) => ({ ...r, employee: empMap.get(r.user_id) })),
        ...(alertData || []).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          work_date: r.created_at.split('T')[0],
          started_at: r.created_at,
          ended_at: r.resolved_at,
          duration_minutes: r.resolved_at
            ? Math.round((new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 60000)
            : null,
          employee: empMap.get(r.user_id),
        })),
      ];
      // Deduplicate by id
      const seen = new Set<string>();
      setGpsDowntime(downtimeRows.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; }));
      setLocationAlerts(
        (alertData || []).map((r: any) => ({ ...r, employee: empMap.get(r.user_id) }))
      );
    } catch (err) {
      console.error('Audit fetch error:', err);
      toast.error('Failed to load audit data');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedEmployee, employees, isManagerOrDirector]);

  const fetchUserMonthlyHours = useCallback(async () => {
    if (!isManagerOrDirector) return;
    setLoadingMonthly(true);
    try {
      const [year, month] = monthFilter.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

      const empFilter = selectedEmployee !== 'all' ? selectedEmployee : null;

      let query = supabase
        .from('attendance_records')
        .select('user_id, total_hours, overtime_hours, status')
        .gte('work_date', startDate)
        .lte('work_date', endDate);

      if (empFilter) query = query.eq('user_id', empFilter);

      const { data, error } = await query;
      if (error) throw error;

      const empMap = new Map(employees.map((e) => [e.id, e]));
      const userMap: Record<string, UserMonthlyHoursSummary> = {};

      (data || []).forEach((r: any) => {
        const emp = empMap.get(r.user_id);
        if (!userMap[r.user_id]) {
          userMap[r.user_id] = {
            user_id: r.user_id,
            full_name: emp?.full_name || 'Unknown',
            department: emp?.department || '—',
            total_hours: 0,
            overtime_hours: 0,
            present_days: 0,
            absent_days: 0,
            late_days: 0,
          };
        }
        userMap[r.user_id].total_hours += Number(r.total_hours) || 0;
        userMap[r.user_id].overtime_hours += Number(r.overtime_hours) || 0;
        if (['present', 'work_from_home', 'half_day'].includes(r.status)) userMap[r.user_id].present_days++;
        if (r.status === 'absent') userMap[r.user_id].absent_days++;
        if (r.status === 'late') userMap[r.user_id].late_days++;
      });

      setUserMonthlyHours(Object.values(userMap).sort((a, b) => b.total_hours - a.total_hours));
    } catch (err) {
      console.error('Monthly hours fetch error:', err);
      toast.error('Failed to load monthly hours');
    } finally {
      setLoadingMonthly(false);
    }
  }, [isManagerOrDirector, monthFilter, selectedEmployee, employees]);

  useEffect(() => {
    if (employees.length > 0) fetchData();
  }, [fetchData, employees]);

  useEffect(() => {
    if (activeTab === 'monthly_hours' && employees.length > 0) fetchUserMonthlyHours();
  }, [activeTab, fetchUserMonthlyHours, employees]);

  // CSV exports
  const exportViolations = () => {
    const headers = ['Employee', 'Department', 'Date', 'Violation', 'Clock In', 'Clock Out', 'Hours'];
    const rows = violations.map((v) => [
      v.employee?.full_name || v.user_id,
      v.employee?.department || '',
      formatDate(v.work_date),
      violationLabels[v.violation_type].label,
      formatTime(v.clock_in),
      formatTime(v.clock_out),
      v.total_hours?.toString() || '0',
    ]);
    downloadCSV(`attendance_violations_${dateFrom}_${dateTo}.csv`, headers, rows);
    toast.success('Violations CSV exported');
  };

  const exportOutOfRadius = () => {
    const headers = ['Employee', 'Department', 'Date', 'Distance (m)', 'Allowed Radius (m)', 'Recorded At'];
    const rows = outOfRadius.map((r) => [
      r.employee?.full_name || r.user_id,
      r.employee?.department || '',
      formatDate(r.work_date),
      r.distance_meters.toFixed(0),
      r.allowed_radius_meters.toString(),
      formatDateTime(r.recorded_at),
    ]);
    downloadCSV(`out_of_radius_${dateFrom}_${dateTo}.csv`, headers, rows);
    toast.success('Out-of-radius CSV exported');
  };

  const exportGPSDowntime = () => {
    const headers = ['Employee', 'Department', 'Date', 'GPS Off At', 'GPS On At', 'Duration (min)'];
    const rows = gpsDowntime.map((r) => [
      r.employee?.full_name || r.user_id,
      r.employee?.department || '',
      formatDate(r.work_date),
      formatDateTime(r.started_at),
      r.ended_at ? formatDateTime(r.ended_at) : 'Still off',
      r.duration_minutes?.toString() || '—',
    ]);
    downloadCSV(`gps_downtime_${dateFrom}_${dateTo}.csv`, headers, rows);
    toast.success('GPS downtime CSV exported');
  };

  const exportMonthlyHours = () => {
    const headers = ['Employee', 'Department', 'Total Hours', 'Overtime Hours', 'Present Days', 'Absent Days', 'Late Days'];
    const rows = userMonthlyHours.map((u) => [
      u.full_name,
      u.department,
      u.total_hours.toFixed(2),
      u.overtime_hours.toFixed(2),
      String(u.present_days),
      String(u.absent_days),
      String(u.late_days),
    ]);
    downloadCSV(`monthly_hours_${monthFilter}.csv`, headers, rows);
    toast.success('Monthly hours CSV exported');
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType; count: number; color: string }[] = [
    { id: 'violations',    label: 'Attendance Violations', icon: AlertTriangle, count: violations.length,  color: 'text-amber-600' },
    { id: 'out_of_radius', label: 'Out-of-Radius Events',  icon: MapPinOff,     count: outOfRadius.length, color: 'text-rose-600' },
    { id: 'gps_downtime',  label: 'GPS Downtime',          icon: WifiOff,       count: gpsDowntime.length, color: 'text-slate-600' },
    { id: 'monthly_hours', label: 'Monthly Hours',         icon: BarChart2,     count: userMonthlyHours.length, color: 'text-indigo-600' },
  ];

  if (!isManagerOrDirector) return null;

  return (
    <>
          <Toaster richColors position="top-right" />
      <div className="flex flex-col h-full bg-slate-50">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
            >
              <ChevronLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Attendance Audit</h1>
              <p className="text-sm text-slate-500">Daily violations, out-of-radius events, and GPS downtime</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Calendar size={14} className="text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm text-slate-700 bg-transparent outline-none"
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-sm text-slate-700 bg-transparent outline-none"
              />
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <Users size={14} className="text-slate-400" />
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="text-sm text-slate-700 bg-transparent outline-none pr-2"
              >
                <option value="all">All Employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="px-6 py-4 grid grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`bg-white rounded-xl border-2 p-4 text-left transition-all ${
                  activeTab === tab.id ? 'border-blue-500 shadow-sm' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon size={18} className={tab.color} />
                  <span className={`text-2xl font-bold ${tab.color}`}>{tab.count}</span>
                </div>
                <p className="text-xs font-medium text-slate-600">{tab.label}</p>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          {/* Violations Tab */}
          {activeTab === 'violations' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <h2 className="font-semibold text-slate-800 text-sm">Attendance Violations</h2>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{violations.length}</span>
                </div>
                <button
                  onClick={exportViolations}
                  disabled={!violations.length}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <RefreshCw size={20} className="animate-spin mr-2" /> Loading...
                </div>
              ) : violations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <AlertTriangle size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No violations found for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-5 py-3 font-medium">Employee</th>
                        <th className="text-left px-4 py-3 font-medium">Date</th>
                        <th className="text-left px-4 py-3 font-medium">Violation</th>
                        <th className="text-left px-4 py-3 font-medium">Clock In</th>
                        <th className="text-left px-4 py-3 font-medium">Clock Out</th>
                        <th className="text-left px-4 py-3 font-medium">Hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {violations.map((v, i) => (
                        <tr key={`${v.id}-${i}`} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-800">{v.employee?.full_name || '—'}</p>
                            <p className="text-xs text-slate-400">{v.employee?.department || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDate(v.work_date)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full border ${violationLabels[v.violation_type].color}`}>
                              {violationLabels[v.violation_type].label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-mono text-xs">{formatTime(v.clock_in)}</td>
                          <td className="px-4 py-3 text-slate-600 font-mono text-xs">{formatTime(v.clock_out)}</td>
                          <td className="px-4 py-3 text-slate-600">{v.total_hours ? `${v.total_hours}h` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Out-of-Radius Tab */}
          {activeTab === 'out_of_radius' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPinOff size={16} className="text-rose-500" />
                  <h2 className="font-semibold text-slate-800 text-sm">Out-of-Radius Events</h2>
                  <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-medium">{outOfRadius.length}</span>
                </div>
                <button
                  onClick={exportOutOfRadius}
                  disabled={!outOfRadius.length}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <RefreshCw size={20} className="animate-spin mr-2" /> Loading...
                </div>
              ) : outOfRadius.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <MapPinOff size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No out-of-radius events found</p>
                  <p className="text-xs mt-1 text-slate-300">Events are recorded when employees clock in/out outside their allowed zone</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-5 py-3 font-medium">Employee</th>
                        <th className="text-left px-4 py-3 font-medium">Date</th>
                        <th className="text-left px-4 py-3 font-medium">Distance</th>
                        <th className="text-left px-4 py-3 font-medium">Allowed</th>
                        <th className="text-left px-4 py-3 font-medium">Excess</th>
                        <th className="text-left px-4 py-3 font-medium">Recorded At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {outOfRadius.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-800">{r.employee?.full_name || '—'}</p>
                            <p className="text-xs text-slate-400">{r.employee?.department || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDate(r.work_date)}</td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-rose-600">{r.distance_meters.toFixed(0)}m</span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{r.allowed_radius_meters}m</td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                              +{(r.distance_meters - r.allowed_radius_meters).toFixed(0)}m over
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(r.recorded_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* GPS Downtime Tab */}
          {activeTab === 'gps_downtime' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <WifiOff size={16} className="text-slate-500" />
                  <h2 className="font-semibold text-slate-800 text-sm">GPS Downtime Events</h2>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{gpsDowntime.length}</span>
                </div>
                <button
                  onClick={exportGPSDowntime}
                  disabled={!gpsDowntime.length}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <RefreshCw size={20} className="animate-spin mr-2" /> Loading...
                </div>
              ) : gpsDowntime.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <WifiOff size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No GPS downtime events found</p>
                  <p className="text-xs mt-1 text-slate-300">Recorded when location services are turned off while clocked in</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-5 py-3 font-medium">Employee</th>
                        <th className="text-left px-4 py-3 font-medium">Date</th>
                        <th className="text-left px-4 py-3 font-medium">GPS Off At</th>
                        <th className="text-left px-4 py-3 font-medium">GPS On At</th>
                        <th className="text-left px-4 py-3 font-medium">Duration</th>
                        <th className="text-left px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gpsDowntime.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-800">{r.employee?.full_name || '—'}</p>
                            <p className="text-xs text-slate-400">{r.employee?.department || ''}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDate(r.work_date)}</td>
                          <td className="px-4 py-3 text-slate-600 font-mono text-xs">{formatDateTime(r.started_at)}</td>
                          <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                            {r.ended_at ? formatDateTime(r.ended_at) : <span className="text-amber-600 font-medium">Still off</span>}
                          </td>
                          <td className="px-4 py-3">
                            {r.duration_minutes != null ? (
                              <span className="font-semibold text-slate-700">{r.duration_minutes} min</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {r.ended_at ? (
                              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Resolved</span>
                            ) : (
                              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Active</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Monthly Hours Tab */}
          {activeTab === 'monthly_hours' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-indigo-500" />
                  <h2 className="font-semibold text-slate-800 text-sm">Monthly Attendance Hours per Employee</h2>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={fetchUserMonthlyHours}
                    disabled={loadingMonthly}
                    className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500"
                  >
                    <RefreshCw size={14} className={loadingMonthly ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={exportMonthlyHours}
                    disabled={!userMonthlyHours.length}
                    className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                  >
                    <Download size={13} /> Export CSV
                  </button>
                </div>
              </div>
              {loadingMonthly ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <RefreshCw size={20} className="animate-spin mr-2" /> Loading...
                </div>
              ) : userMonthlyHours.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <BarChart2 size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No attendance data for this month</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-5 py-3 font-medium">Employee</th>
                        <th className="text-left px-4 py-3 font-medium">Department</th>
                        <th className="text-right px-4 py-3 font-medium">Total Hours</th>
                        <th className="text-right px-4 py-3 font-medium">Overtime</th>
                        <th className="text-right px-4 py-3 font-medium">Present</th>
                        <th className="text-right px-4 py-3 font-medium">Absent</th>
                        <th className="text-right px-4 py-3 font-medium">Late</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {userMonthlyHours.map((u) => (
                        <tr key={u.user_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-indigo-700">{u.full_name.charAt(0).toUpperCase()}</span>
                              </div>
                              <p className="font-medium text-slate-800">{u.full_name}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{u.department}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-bold text-indigo-700">{u.total_hours.toFixed(1)}h</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${u.overtime_hours > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                              {u.overtime_hours.toFixed(1)}h
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-emerald-600">{u.present_days}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${u.absent_days > 0 ? 'text-red-600' : 'text-slate-400'}`}>{u.absent_days}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${u.late_days > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{u.late_days}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={2} className="px-5 py-3 text-xs font-bold text-slate-600">TOTAL ({userMonthlyHours.length} employees)</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-700">
                          {userMonthlyHours.reduce((s, u) => s + u.total_hours, 0).toFixed(1)}h
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-orange-600">
                          {userMonthlyHours.reduce((s, u) => s + u.overtime_hours, 0).toFixed(1)}h
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-600">
                          {userMonthlyHours.reduce((s, u) => s + u.present_days, 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">
                          {userMonthlyHours.reduce((s, u) => s + u.absent_days, 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-amber-600">
                          {userMonthlyHours.reduce((s, u) => s + u.late_days, 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
'use client';

// Shared filter for the Analytics & Reporting page.
// The header sets the date range and department; every chart and KPI reads the
// same values here, and Refresh bumps refreshKey so the data reloads in place
// (the page itself is not reloaded, so the chosen filter is kept).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export const DATE_RANGES = ['Today', 'Last 7 days', 'Last 30 days', 'This Quarter', 'Last Quarter', 'This Year', 'Custom Range'] as const;
export type DateRangeLabel = typeof DATE_RANGES[number];
export const ALL_DEPARTMENTS = 'All Departments';

// Local-date helpers. Never use toISOString() for date-only values: in IST
// (UTC+5:30) local midnight becomes the previous UTC day.
const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toLocalStr(d); };

// 'YYYY-MM-DD' -> '13 Oct 2026'
export function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function computeRange(label: DateRangeLabel, custom: { start: string; end: string }): { start: string; end: string } {
  const now = new Date();
  const today = toLocalStr(now);
  const q = Math.floor(now.getMonth() / 3);
  switch (label) {
    case 'Today':
      return { start: today, end: today };
    case 'Last 7 days':
      return { start: daysAgo(6), end: today };
    case 'Last 30 days':
      return { start: daysAgo(29), end: today };
    case 'This Quarter':
      return { start: toLocalStr(new Date(now.getFullYear(), q * 3, 1)), end: today };
    case 'Last Quarter': {
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return {
        start: toLocalStr(new Date(ly, lq * 3, 1)),
        end: toLocalStr(new Date(ly, lq * 3 + 3, 0)), // last day of that quarter
      };
    }
    case 'This Year':
      return { start: `${now.getFullYear()}-01-01`, end: today };
    case 'Custom Range':
      return custom.start && custom.end ? { start: custom.start, end: custom.end } : { start: daysAgo(29), end: today };
  }
}

interface AnalyticsFilterValue {
  dateRange: DateRangeLabel;
  setDateRange: (r: DateRangeLabel) => void;
  customStart: string;
  customEnd: string;
  setCustomRange: (start: string, end: string) => void;
  start: string;                       // YYYY-MM-DD, inclusive
  end: string;                         // YYYY-MM-DD, inclusive
  rangeLabel: string;                  // e.g. "Last 30 days (14 Sep 2026 – 13 Oct 2026)" or "Today (13 Oct 2026)"
  department: string;                  // 'All Departments' or a department name
  setDepartment: (d: string) => void;
  departments: string[];               // real departments from user_profiles
  deptUserIds: Set<string> | null;     // null = all users
  refreshKey: number;
  refresh: () => void;
}

const AnalyticsFilterContext = createContext<AnalyticsFilterValue | null>(null);

export function AnalyticsFilterProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [dateRange, setDateRange] = useState<DateRangeLabel>('Last 30 days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [departments, setDepartments] = useState<string[]>([]);
  const [deptUserIds, setDeptUserIds] = useState<Set<string> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Recomputed on every refresh, so "Today" and the relative ranges move with the clock
  const range = useMemo(
    () => computeRange(dateRange, { start: customStart, end: customEnd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateRange, customStart, customEnd, refreshKey],
  );

  const rangeLabel = useMemo(() => {
    if (dateRange === 'Today') return `Today (${fmtYmd(range.end)})`;
    return `${dateRange} (${fmtYmd(range.start)} – ${fmtYmd(range.end)})`;
  }, [dateRange, range]);

  // Departments and the users in the selected department
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('user_profiles').select('id, department').eq('is_active', true);
        if (cancelled) return;
        const rows = data || [];
        const depts = [...new Set(rows.map((r: any) => r.department).filter(Boolean))].sort() as string[];
        setDepartments(depts);
        if (department === ALL_DEPARTMENTS) setDeptUserIds(null);
        else setDeptUserIds(new Set(rows.filter((r: any) => r.department === department).map((r: any) => r.id)));
      } catch {
        if (!cancelled) setDeptUserIds(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, refreshKey]);

  const setCustomRange = useCallback((s: string, e: string) => { setCustomStart(s); setCustomEnd(e); }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const value: AnalyticsFilterValue = {
    dateRange,
    setDateRange,
    customStart,
    customEnd,
    setCustomRange,
    start: range.start,
    end: range.end,
    rangeLabel,
    department,
    setDepartment,
    departments,
    deptUserIds,
    refreshKey,
    refresh,
  };

  return <AnalyticsFilterContext.Provider value={value}>{children}</AnalyticsFilterContext.Provider>;
}

export function useAnalyticsFilter(): AnalyticsFilterValue {
  const ctx = useContext(AnalyticsFilterContext);
  if (!ctx) throw new Error('useAnalyticsFilter must be used inside AnalyticsFilterProvider');
  return ctx;
}
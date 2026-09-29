'use client';

import React from 'react';
import AnalyticsHeader from './components/AnalyticsHeader';
import AnalyticsKPIGrid from './components/AnalyticsKPIGrid';
import AttendanceTrendChart from './components/AttendanceTrendChart';
import DepartmentProductivityChart from './components/DepartmentProductivityChart';
import LeavePatternChart from './components/LeavePatternChart';
import DepartmentBreakdownTable from './components/DepartmentBreakdownTable';
import RedFlagPanel from './components/RedFlagPanel';
import MonthlyHoursPerUserChart from './components/MonthlyHoursPerUserChart';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, FileText, BarChart3 } from 'lucide-react';

function ReportsOnlyView() {
  return (
    <div>
      <AnalyticsHeader />
      <AnalyticsKPIGrid />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
        <AttendanceTrendChart />
        <LeavePatternChart />
      </div>
      <div className="mt-5">
        <MonthlyHoursPerUserChart />
      </div>
      <div className="mt-5">
        <DepartmentBreakdownTable />
      </div>
      {/* Access restriction notice */}
      <div className="mt-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
          <Lock size={16} className="text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-700 text-amber-800 dark:text-amber-300">Full Analysis Restricted</p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
            Detailed employee analysis, productivity breakdowns, red flag panels, and individual performance data are only accessible to Directors. You have access to summary reports and department-level data.
          </p>
        </div>
      </div>
    </div>
  );
}

function FullAnalysisView() {
  return (
    <div>
      <AnalyticsHeader />
      <AnalyticsKPIGrid />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
        <AttendanceTrendChart />
        <DepartmentProductivityChart />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
        <LeavePatternChart />
        <MonthlyHoursPerUserChart />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5">
        <div className="xl:col-span-2">
          <DepartmentBreakdownTable />
        </div>
        <div>
          <RedFlagPanel />
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const { pinSession } = useAuth();
  const role = pinSession?.role?.toLowerCase() || 'employee';
  const isDirector = role === 'director';
  const canViewReports = ['director', 'manager', 'executive']?.includes(role);

  if (!canViewReports) {
    return (
              <div className="max-w-screen-2xl mx-auto px-6 lg:px-8 xl:px-10 py-6">
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <Lock size={28} className="text-slate-400" />
            </div>
            <h2 className="text-xl font-700 text-slate-800 dark:text-slate-200 mb-2">Access Restricted</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Analytics & Reporting is available to Managers, Executives, and Directors only.
            </p>
          </div>
        </div>
    );
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-6 lg:px-8 xl:px-10 py-6">
      {/* Role badge */}
      <div className="flex items-center gap-2 mb-4">
        {isDirector ? (
          <div className="flex items-center gap-1.5 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-1.5">
            <BarChart3 size={13} className="text-violet-600" />
            <span className="text-xs font-600 text-violet-700 dark:text-violet-400">Full Analysis Access — Director</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-1.5">
            <FileText size={13} className="text-blue-600" />
            <span className="text-xs font-600 text-blue-700 dark:text-blue-400">Reports Access — {role?.charAt(0)?.toUpperCase() + role?.slice(1)}</span>
          </div>
        )}
      </div>

      {isDirector ? <FullAnalysisView /> : <ReportsOnlyView />}
    </div>
  );
}
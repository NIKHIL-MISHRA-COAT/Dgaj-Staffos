// v2 — force chunk rebuild
'use client';

import React, { useEffect, useState } from 'react';
import DashboardHeader from './components/DashboardHeader';
import AttendanceHero from './components/AttendanceHero';
import KPIBentoGrid from './components/KPIBentoGrid';
import WeeklyAttendanceChart from './components/WeeklyAttendanceChart';
import TodayTasksBox from './components/TodayTasksBox';
import LeaveBalancePanel from './components/LeaveBalancePanel';
import ActivityFeed from './components/ActivityFeed';
import PermissionsPopup, { PERMISSIONS_DISMISSED_KEY } from '@/components/PermissionsPopup';

export default function EmployeeDashboardPage() {
  const [showPermissions, setShowPermissions] = useState(false);

  useEffect(() => {
    const checkAndShowPermissions = async () => {
      // Check if permissions were previously dismissed/granted
      const dismissed = localStorage.getItem(PERMISSIONS_DISMISSED_KEY);

      // Always check current permission state regardless of dismissal
      let locationGranted = false;
      let notificationsGranted = false;

      // Check location permission
      if (!navigator.geolocation) {
        locationGranted = true; // unsupported — treat as OK
      } else if (navigator.permissions) {
        try {
          const geo = await navigator.permissions?.query({ name: 'geolocation' });
          locationGranted = geo?.state === 'granted';
        } catch {
          locationGranted = false;
        }
      }

      // Check notification permission
      if (!('Notification' in window)) {
        notificationsGranted = true; // unsupported — treat as OK
      } else {
        notificationsGranted = Notification.permission === 'granted';
      }

      const allGranted = locationGranted && notificationsGranted;

      if (!dismissed) {
        // First time — always show popup
        setShowPermissions(true);
      } else if (!allGranted) {
        // Previously dismissed but a permission was revoked — show again
        localStorage.removeItem(PERMISSIONS_DISMISSED_KEY);
        setShowPermissions(true);
      }
    };

    checkAndShowPermissions();
  }, []);

  return (
    <>
      {showPermissions && (
        <PermissionsPopup onClose={() => setShowPermissions(false)} />
      )}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-4 sm:py-6">
        <DashboardHeader />
        <AttendanceHero />
        <KPIBentoGrid />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5 mt-4 sm:mt-5">
          <div className="xl:col-span-2 space-y-4 sm:space-y-5">
            <WeeklyAttendanceChart />
            <TodayTasksBox />
          </div>
          <div className="space-y-4 sm:space-y-5">
            <LeaveBalancePanel />
            <ActivityFeed />
          </div>
        </div>
      </div>
    </>
  );
}
'use client';

import { useEffect, useState } from 'react';
import { MapPin, Bell, X, CheckCircle, AlertCircle } from 'lucide-react';

const PERMISSIONS_DISMISSED_KEY = 'dgaj_permissions_granted';

interface PermissionStatus {
  location: 'granted' | 'denied' | 'prompt' | 'unsupported';
  notifications: 'granted' | 'denied' | 'prompt' | 'unsupported';
}

interface PermissionsPopupProps {
  onClose: () => void;
}

export default function PermissionsPopup({ onClose }: PermissionsPopupProps) {
  const [status, setStatus] = useState<PermissionStatus>({
    location: 'prompt',
    notifications: 'prompt',
  });
  const [requesting, setRequesting] = useState<'location' | 'notifications' | null>(null);

  const checkPermissions = async () => {
    const newStatus: PermissionStatus = {
      location: 'prompt',
      notifications: 'prompt',
    };

    // Check location
    if (!navigator.geolocation) {
      newStatus.location = 'unsupported';
    } else if (navigator.permissions) {
      try {
        const geo = await navigator.permissions.query({ name: 'geolocation' });
        newStatus.location = geo.state as any;
      } catch {
        newStatus.location = 'prompt';
      }
    }

    // Check notifications
    if (!('Notification' in window)) {
      newStatus.notifications = 'unsupported';
    } else {
      newStatus.notifications = Notification.permission as any;
    }

    setStatus(newStatus);
    return newStatus;
  };

  const requestLocation = async () => {
    setRequesting('location');
    try {
      await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      setStatus(prev => ({ ...prev, location: 'granted' }));
    } catch {
      setStatus(prev => ({ ...prev, location: 'denied' }));
    } finally {
      setRequesting(null);
    }
  };

  const requestNotifications = async () => {
    setRequesting('notifications');
    try {
      const result = await Notification.requestPermission();
      setStatus(prev => ({ ...prev, notifications: result as any }));
    } catch {
      setStatus(prev => ({ ...prev, notifications: 'denied' }));
    } finally {
      setRequesting(null);
    }
  };

  const handleEnableAll = async () => {
    if (status.location !== 'granted' && status.location !== 'unsupported') {
      await requestLocation();
    }
    if (status.notifications !== 'granted' && status.notifications !== 'unsupported') {
      await requestNotifications();
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(PERMISSIONS_DISMISSED_KEY, 'true');
    onClose();
  };

  useEffect(() => {
    checkPermissions();
  }, []);

  const allGranted =
    (status.location === 'granted' || status.location === 'unsupported') &&
    (status.notifications === 'granted' || status.notifications === 'unsupported');

  const getStatusIcon = (s: string) => {
    if (s === 'granted') return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (s === 'denied') return <AlertCircle className="w-5 h-5 text-red-500" />;
    return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
  };

  const getStatusText = (s: string) => {
    if (s === 'granted') return 'Enabled';
    if (s === 'denied') return 'Denied – enable in browser settings';
    if (s === 'unsupported') return 'Not supported on this device';
    return 'Not yet enabled';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        {/* Close */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
            <MapPin className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Enable Permissions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            DGAJ Connect needs access to your location and notifications to work properly.
          </p>
        </div>

        {/* Permission Items */}
        <div className="space-y-3 mb-6">
          {/* Location */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Location Services</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{getStatusText(status.location)}</p>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(status.location)}
              {status.location === 'prompt' && (
                <button
                  onClick={requestLocation}
                  disabled={requesting === 'location'}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {requesting === 'location' ? '...' : 'Enable'}
                </button>
              )}
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center flex-shrink-0">
              <Bell className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{getStatusText(status.notifications)}</p>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(status.notifications)}
              {status.notifications === 'prompt' && (
                <button
                  onClick={requestNotifications}
                  disabled={requesting === 'notifications'}
                  className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {requesting === 'notifications' ? '...' : 'Enable'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!allGranted && (
            <button
              onClick={handleEnableAll}
              disabled={requesting !== null}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              {requesting ? 'Requesting...' : 'Enable All Permissions'}
            </button>
          )}
          {allGranted ? (
            <button
              onClick={handleDismiss}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              All Set – Continue
            </button>
          ) : (
            <button
              onClick={handleDismiss}
              className="w-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm py-2 transition-colors"
            >
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { PERMISSIONS_DISMISSED_KEY };

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, MapPin, CheckCircle2, LogIn, LogOut, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { queueBreadcrumb, syncPendingBreadcrumbs } from '@/lib/gpsQueue';

type AttendanceState = 'not-clocked-in' | 'clocked-in' | 'clocked-out';

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface LocationSetting {
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  office_name: string;
  enforce_radius?: boolean;
  block_clock_in?: boolean;
}

// Haversine distance in meters between two lat/lng points
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Exported so Sidebar can call it on logout
export async function performClockOut(userId: string): Promise<void> {
  const supabase = createClient();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  const { data: existing } = await supabase
    .from('attendance_records')
    .select('id, clock_in, clock_out')
    .eq('user_id', userId)
    .eq('work_date', today)
    .single();

  if (!existing || existing.clock_out) return;

  let totalHours = 0;
  if (existing.clock_in) {
    const diff = now.getTime() - new Date(existing.clock_in).getTime();
    totalHours = Math.round((diff / 3600000) * 100) / 100;
  }

  await supabase
    .from('attendance_records')
    .update({
      clock_out: now.toISOString(),
      total_hours: totalHours,
      updated_at: now.toISOString(),
    })
    .eq('id', existing.id);

  await supabase
    .from('employee_locations')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
}

export default function AttendanceHero() {
  const [state, setState] = useState<AttendanceState>('not-clocked-in');
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [clockOutTime, setClockOutTime] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'>('idle');
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [attendanceRecordId, setAttendanceRecordId] = useState<string | null>(null);
  const [locationSetting, setLocationSetting] = useState<LocationSetting | null>(null);
  const [locationAlertSent, setLocationAlertSent] = useState(false);
  const [travelApproved, setTravelApproved] = useState(false);
  const routeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const locationMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastBreadcrumbRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const { user, pinSession } = useAuth();
  const supabase = createClient();

  // Resolve effective user ID — Supabase auth user OR PIN session user
  const getEffectiveUserId = (): string | null => {
    if (user?.id) return user.id;
    if (pinSession?.userId) return pinSession.userId;
    try {
      const stored = localStorage.getItem('dgaj_pin_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.userId || null;
      }
    } catch {}
    return null;
  };

  const getNow = () => {
    const d = new Date();
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getToday = () => new Date().toISOString().split('T')[0];

  // Load existing attendance record + location setting on mount
  useEffect(() => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) return;
    const init = async () => {
      const today = getToday();

      const [attendanceRes, settingRes, profileRes, firmSettingRes] = await Promise.all([
        supabase
          .from('attendance_records')
          .select('id, clock_in, clock_out')
          .eq('user_id', effectiveId)
          .eq('work_date', today)
          .single(),
        supabase
          .from('location_settings')
          .select('center_latitude, center_longitude, radius_meters, office_name, enforce_radius, block_clock_in')
          .eq('user_id', effectiveId)
          .single(),
        supabase
          .from('user_profiles')
          .select('travel_approved, firms!firm_id(office_name, center_latitude, center_longitude, radius_meters, enforce_radius, block_clock_in)')
          .eq('id', effectiveId)
          .single(),
        supabase
          .from('director_settings')
          .select('setting_value')
          .eq('setting_key', 'location_radius')
          .single(),
      ]);

      if (attendanceRes.data) {
        setAttendanceRecordId(attendanceRes.data.id);
        if (attendanceRes.data.clock_in) {
          const t = new Date(attendanceRes.data.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          setClockInTime(t);
          setState(attendanceRes.data.clock_out ? 'clocked-out' : 'clocked-in');
        }
        if (attendanceRes.data.clock_out) {
          const t = new Date(attendanceRes.data.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          setClockOutTime(t);
        }
      }

      // Priority: personal override (location_settings) > the employee's firm office > director default
      const firmRow: any = (profileRes.data as any)?.firms;
      const hasFirmOffice = !!(firmRow?.center_latitude && firmRow?.center_longitude);

      if (settingRes.data) {
        // Merge firm-level enforce_radius / block_clock_in from director_settings if present
        const firmLoc = firmSettingRes.data?.setting_value as any;
        setLocationSetting({
          ...settingRes.data as LocationSetting,
          enforce_radius: firmRow?.enforce_radius ?? firmLoc?.enforce_radius ?? settingRes.data.enforce_radius ?? false,
          block_clock_in: firmRow?.block_clock_in ?? firmLoc?.block_clock_in ?? settingRes.data.block_clock_in ?? false,
        });
      } else if (hasFirmOffice) {
        setLocationSetting({
          center_latitude: firmRow.center_latitude,
          center_longitude: firmRow.center_longitude,
          radius_meters: firmRow.radius_meters || 200,
          office_name: firmRow.office_name || 'Office',
          enforce_radius: firmRow.enforce_radius ?? false,
          block_clock_in: firmRow.block_clock_in ?? false,
        });
      } else if (firmSettingRes.data?.setting_value) {
        // No per-user setting and no firm office — use director default
        const firmLoc = firmSettingRes.data.setting_value as any;
        if (firmLoc?.center_latitude && firmLoc?.center_longitude && firmLoc?.default_radius_meters) {
          setLocationSetting({
            center_latitude: firmLoc.center_latitude,
            center_longitude: firmLoc.center_longitude,
            radius_meters: firmLoc.default_radius_meters,
            office_name: firmLoc.office_name || 'Office',
            enforce_radius: firmLoc.enforce_radius ?? false,
            block_clock_in: firmLoc.block_clock_in ?? false,
          });
        }
      }

      if (profileRes.data) {
        setTravelApproved(profileRes.data.travel_approved === true);
      }
    };
    init();
  }, [user?.id, pinSession?.userId]);

  // Start/stop route tracking breadcrumb interval when clocked in
  useEffect(() => {
    const effectiveId = getEffectiveUserId();
    if (state === 'clocked-in' && effectiveId) {
      startRouteTracking();
      startLocationMonitor();
    } else {
      stopRouteTracking();
      stopLocationMonitor();
      setLocationAlertSent(false);
    }
    return () => {
      stopRouteTracking();
      stopLocationMonitor();
    };
  }, [state, user?.id, pinSession?.userId]);

  // Minimum movement (meters) and time (ms) before a new fix is worth recording.
  const MIN_MOVE_METERS = 15;
  const MIN_INTERVAL_MS = 30 * 1000; // record at most once every 30s even if moving fast
  const LIVE_TABLE_UPDATE_MS = 20 * 1000; // push a live position update at least this often

  const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const lastLiveUpdateRef = useRef<number>(0);

  const startRouteTracking = () => {
    if (watchIdRef.current !== null || !navigator.geolocation) return;

    // Continuous high-accuracy GPS stream instead of periodic polling — the
    // browser pushes a new fix whenever the device actually moves, so both
    // the route history and the director's live map reflect real position
    // changes within seconds rather than every 5 minutes.
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const effectiveId = getEffectiveUserId();
        if (!effectiveId) return;

        const { latitude, longitude, accuracy } = position.coords;
        const now = Date.now();
        const last = lastBreadcrumbRef.current;
        const movedEnough = !last || haversineMeters(last.lat, last.lng, latitude, longitude) >= MIN_MOVE_METERS;
        const enoughTimePassed = !last || now - last.t >= MIN_INTERVAL_MS;

        // Always push a lightweight "live" position update on the active
        // employee_locations row so directors see near-real-time movement,
        // even for small in-place jitter, but throttled to avoid write storms.
        if (now - lastLiveUpdateRef.current >= LIVE_TABLE_UPDATE_MS) {
          lastLiveUpdateRef.current = now;
          supabase
            .from('employee_locations')
            .update({ latitude, longitude, accuracy, recorded_at: new Date(now).toISOString() })
            .eq('user_id', effectiveId)
            .eq('is_active', true)
            .then(({ error }) => {
              if (error) console.warn('Live location update failed:', error.message);
            });
        }

        // Only persist a route breadcrumb (path history) when the device has
        // actually moved a meaningful distance, or enough time has elapsed.
        if (movedEnough && enoughTimePassed) {
          lastBreadcrumbRef.current = { lat: latitude, lng: longitude, t: now };
          const crumb = {
            user_id: effectiveId,
            latitude,
            longitude,
            accuracy,
            recorded_at: new Date(now).toISOString(),
            work_date: getToday(),
          };
          if (navigator.onLine) {
            try {
              const { error } = await supabase.from('route_tracking').insert(crumb);
              if (error) {
                console.warn('Route insert failed, queuing:', error.message);
                await queueBreadcrumb(crumb);
              }
            } catch {
              await queueBreadcrumb(crumb);
            }
          } else {
            await queueBreadcrumb(crumb);
          }
        }
      },
      (err) => console.warn('Route tracking GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    // Safety net: some mobile browsers throttle watchPosition heavily when
    // the tab is backgrounded. A slow interval fallback guarantees at least
    // one fresh fix every 5 minutes even in that case.
    if (!routeIntervalRef.current) {
      routeIntervalRef.current = setInterval(() => {
        recordRouteBreadcrumb();
      }, 5 * 60 * 1000);
    }
  };

  const stopRouteTracking = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (routeIntervalRef.current) {
      clearInterval(routeIntervalRef.current);
      routeIntervalRef.current = null;
    }
    lastBreadcrumbRef.current = null;
    lastLiveUpdateRef.current = 0;
  };

  const recordRouteBreadcrumb = () => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const crumb = {
          user_id: effectiveId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recorded_at: new Date().toISOString(),
          work_date: getToday(),
        };

        if (navigator.onLine) {
          // Online: try direct insert, fallback to queue on error
          try {
            const { error } = await supabase.from('route_tracking').insert(crumb);
            if (error) {
              console.warn('Route insert failed, queuing:', error.message);
              await queueBreadcrumb(crumb);
            }
          } catch {
            await queueBreadcrumb(crumb);
          }
        } else {
          // Offline: queue in IndexedDB
          await queueBreadcrumb(crumb);
        }
      },
      (err) => console.warn('Route breadcrumb GPS error:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // Auto-sync queued breadcrumbs when network comes back online
  useEffect(() => {
    const handleOnline = async () => {
      const synced = await syncPendingBreadcrumbs(async (rows) => {
        const { error } = await supabase.from('route_tracking').insert(rows);
        return { error };
      });
      if (synced > 0) {
        toast.success(`📡 Synced ${synced} GPS breadcrumb${synced > 1 ? 's' : ''} from offline queue`, { duration: 4000 });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const getGeolocationErrorMessage = (error: GeolocationPositionError): string => {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return 'Location permission denied. Please enable location access in your browser/device settings and try again.';
      case error.POSITION_UNAVAILABLE:
        return 'Location information is unavailable. Check that GPS is enabled on your device.';
      case error.TIMEOUT:
        return 'Location request timed out. Please try again in a moment.';
      default:
        return 'Unable to retrieve location. Clocking in without GPS.';
    }
  };

  const requestLocation = (): Promise<LocationData> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setLocationStatus('unavailable');
        reject(new Error('Geolocation is not supported by your browser'));
        return;
      }
      setLocationStatus('requesting');
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then((permResult) => {
          if (permResult.state === 'denied') {
            setLocationStatus('denied');
            reject(Object.assign(new Error('Location permission denied'), { code: 1 }));
            return;
          }
          doGetCurrentPosition(resolve, reject);
        }).catch(() => doGetCurrentPosition(resolve, reject));
      } else {
        doGetCurrentPosition(resolve, reject);
      }
    });
  };

  const doGetCurrentPosition = (
    resolve: (loc: LocationData) => void,
    reject: (err: any) => void
  ) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        let loc: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setCurrentLocation(loc);
        setLocationStatus('granted');
        resolve(loc);
      },
      (error: GeolocationPositionError) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationStatus('denied');
        } else {
          setLocationStatus('unavailable');
        }
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const saveLocation = async (loc: LocationData, eventType: 'clock_in' | 'clock_out') => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) return;
    try {
      await supabase
        .from('employee_locations')
        .update({ is_active: false })
        .eq('user_id', effectiveId)
        .eq('is_active', true);

      const { error } = await supabase.from('employee_locations').insert({
        user_id: effectiveId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        event_type: eventType,
        is_active: eventType === 'clock_in',
      });

      if (error) console.error('Failed to save location to DB:', error.message);
    } catch (err) {
      console.error('saveLocation error:', err);
    }
  };

  const saveRouteBreadcrumb = async (loc: LocationData) => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) return;
    const crumb = {
      user_id: effectiveId,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      recorded_at: new Date().toISOString(),
      work_date: getToday(),
    };
    if (navigator.onLine) {
      try {
        const { error } = await supabase.from('route_tracking').insert(crumb);
        if (error) await queueBreadcrumb(crumb);
      } catch {
        await queueBreadcrumb(crumb);
      }
    } else {
      await queueBreadcrumb(crumb);
    }
  };

  // Validate location against configured radius
  const validateRadius = (loc: LocationData): { valid: boolean; distance: number } => {
    if (!locationSetting) return { valid: true, distance: 0 };
    const distance = getDistanceMeters(
      loc.latitude,
      loc.longitude,
      locationSetting.center_latitude,
      locationSetting.center_longitude
    );
    return { valid: distance <= locationSetting.radius_meters, distance: Math.round(distance) };
  };

  // Record out-of-radius event to DB
  const recordOutOfRadiusEvent = async (loc: LocationData, distance: number) => {
    if (!user?.id || !locationSetting) return;
    try {
      await supabase.from('out_of_radius_events').insert({
        user_id: user.id,
        work_date: getToday(),
        latitude: loc.latitude,
        longitude: loc.longitude,
        distance_meters: distance,
        allowed_radius_meters: locationSetting.radius_meters,
        recorded_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('recordOutOfRadiusEvent error:', err);
    }
  };

  const handleClockIn = async () => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) {
      toast.error('You must be logged in to clock in. Please log in with your PIN first.');
      return;
    }
    setIsLoading(true);
    let loc: LocationData | null = null;

    try {
      try {
        loc = await requestLocation();
      } catch (geoErr: any) {
        const msg = geoErr?.code !== undefined
          ? getGeolocationErrorMessage(geoErr as GeolocationPositionError)
          : (geoErr?.message || 'Location unavailable');
        toast.warning(`⚠️ ${msg}`, { duration: 6000 });
      }

      // Radius check — skip entirely for travel-approved employees OR when no location setting configured
      if (loc && locationSetting && locationSetting.radius_meters > 0 && !travelApproved) {
        const { valid, distance } = validateRadius(loc);
        if (!valid) {
          await recordOutOfRadiusEvent(loc, distance);
          if (locationSetting.block_clock_in) {
            // Director has configured hard block — prevent clock-in
            toast.error(
              `🚫 Clock-in blocked: You are ${distance}m away from ${locationSetting.office_name} (allowed: ${locationSetting.radius_meters}m). Please move closer to the office.`,
              { duration: 8000 }
            );
            setIsLoading(false);
            return;
          } else if (locationSetting.enforce_radius) {
            // Warn but allow — director notified
            toast.warning(
              `⚠️ Outside allowed radius: ${distance}m from ${locationSetting.office_name} (limit: ${locationSetting.radius_meters}m). Your director has been notified.`,
              { duration: 6000 }
            );
            // Notify directors
            try {
              const { data: directors } = await supabase
                .from('user_profiles')
                .select('id')
                .in('role', ['director', 'manager', 'executive']);
              if (directors && directors.length > 0) {
                const { data: empProfile } = await supabase
                  .from('user_profiles')
                  .select('full_name')
                  .eq('id', effectiveId)
                  .single();
                const empName = empProfile?.full_name || 'An employee';
                await supabase.from('notifications').insert(
                  directors.map((d) => ({
                    user_id: d.id,
                    type: 'general',
                    title: '📍 Out-of-Radius Clock-In',
                    message: `${empName} clocked in ${distance}m away from ${locationSetting.office_name} (limit: ${locationSetting.radius_meters}m).`,
                    is_read: false,
                  }))
                );
              }
            } catch {}
          } else {
            // No enforcement — just log silently
            toast.warning(
              `📍 You are ${distance}m away from ${locationSetting.office_name} (allowed: ${locationSetting.radius_meters}m). Your location has been recorded.`,
              { duration: 6000 }
            );
          }
        }
      }

      const now = new Date();
      const today = getToday();
      const t = getNow();

      const { data: record, error } = await supabase
        .from('attendance_records')
        .upsert(
          {
            user_id: effectiveId,
            work_date: today,
            clock_in: now.toISOString(),
            status: 'present',
          },
          { onConflict: 'user_id,work_date' }
        )
        .select('id')
        .single();

      if (error) {
        console.error('Clock-in DB error:', error.message);
        throw error;
      }
      if (record) setAttendanceRecordId(record.id);

      if (loc) {
        await saveLocation(loc, 'clock_in');
        await saveRouteBreadcrumb(loc);
      }

      setClockInTime(t);
      setState('clocked-in');
      toast.success(
        `Clocked in at ${t}${loc ? ' 📍 Location recorded' : ' (no GPS)'}`,
        { duration: 3000 }
      );
    } catch (err: any) {
      toast.error(err?.message || 'Failed to clock in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async () => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) return;
    setIsLoading(true);
    let loc: LocationData | null = null;

    try {
      try {
        loc = await requestLocation();
      } catch (geoErr: any) {
        if (geoErr?.code === 1) {
          toast.warning('Location not recorded — GPS permission denied.', { duration: 4000 });
        }
      }

      // Radius check on clock-out — skip for travel-approved employees
      if (loc && locationSetting && locationSetting.radius_meters > 0 && !travelApproved) {
        const { valid, distance } = validateRadius(loc);
        if (!valid) {
          await recordOutOfRadiusEvent(loc, distance);
          toast.warning(
            `📍 Clocking out ${distance}m away from ${locationSetting.office_name} (allowed: ${locationSetting.radius_meters}m).`,
            { duration: 5000 }
          );
        }
      }

      const now = new Date();
      const today = getToday();
      const t = getNow();

      let totalHours = 0;
      if (attendanceRecordId) {
        const { data: existing } = await supabase
          .from('attendance_records')
          .select('clock_in')
          .eq('id', attendanceRecordId)
          .single();
        if (existing?.clock_in) {
          const diff = now.getTime() - new Date(existing.clock_in).getTime();
          totalHours = Math.round((diff / 3600000) * 100) / 100;
        }
      }

      const { error } = await supabase
        .from('attendance_records')
        .update({
          clock_out: now.toISOString(),
          total_hours: totalHours,
          updated_at: now.toISOString(),
        })
        .eq('user_id', effectiveId)
        .eq('work_date', today);

      if (error) {
        console.error('Clock-out DB error:', error.message);
        throw error;
      }

      if (loc) {
        await saveLocation(loc, 'clock_out');
        await saveRouteBreadcrumb(loc);
      }

      await supabase
        .from('employee_locations')
        .update({ is_active: false })
        .eq('user_id', effectiveId)
        .eq('is_active', true);

      stopRouteTracking();
      setClockOutTime(t);
      setState('clocked-out');
      toast.success(`Clocked out at ${t} — Have a great evening!`, { duration: 3000 });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to clock out. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const startLocationMonitor = () => {
    if (locationMonitorRef.current) return;
    // Check every 2 minutes if location permission is still active
    locationMonitorRef.current = setInterval(() => {
      checkLocationPermission();
    }, 2 * 60 * 1000);
  };

  const stopLocationMonitor = () => {
    if (locationMonitorRef.current) {
      clearInterval(locationMonitorRef.current);
      locationMonitorRef.current = null;
    }
  };

  const checkLocationPermission = async () => {
    const effectiveId = getEffectiveUserId();
    if (!effectiveId) return;
    if (!navigator.geolocation) return;
    // Travel-approved employees are exempt from location alerts
    if (travelApproved) return;

    const sendAlert = async () => {
      if (locationAlertSent) return;
      setLocationAlertSent(true);
      setLocationStatus('denied');

      try {
        // 1. Insert location_alert record
        await supabase.from('location_alerts').insert({
          user_id: effectiveId,
          alert_type: 'location_off',
          message: `Employee turned off location services while clocked in.`,
        });

        // 2. Get employee name
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('full_name, job_title')
          .eq('id', effectiveId)
          .single();

        const employeeName = profile?.full_name || 'An employee';
        const jobTitle = profile?.job_title ? ` (${profile.job_title})` : '';

        // 3. Find all directors to notify
        const { data: directors } = await supabase
          .from('user_profiles')
          .select('id')
          .in('role', ['director', 'manager', 'executive']);

        if (directors && directors.length > 0) {
          const notifications = directors.map((d) => ({
            user_id: d.id,
            type: 'general',
            title: '⚠️ Location Services Disabled',
            message: `${employeeName}${jobTitle} has turned off location services on their device while clocked in. Please follow up.`,
            is_read: false,
          }));
          await supabase.from('notifications').insert(notifications);
        }

        toast.warning('⚠️ Location services appear to be off. Your director has been notified.', { duration: 8000 });
      } catch (err) {
        console.error('Failed to send location alert:', err);
      }
    };

    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (result.state === 'denied') {
          await sendAlert();
          return;
        }
        // Also try a quick position check to confirm GPS is truly accessible
        if (result.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            () => {
              // GPS still working — reset alert flag so it can fire again if later denied
              setLocationAlertSent(false);
              setLocationStatus('granted');
            },
            async (err) => {
              if (err.code === err.PERMISSION_DENIED) {
                await sendAlert();
              }
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
          );
        }
      } catch {
        // permissions API not available, fallback to direct check
        navigator.geolocation.getCurrentPosition(
          () => { setLocationAlertSent(false); },
          async (err) => {
            if (err.code === err.PERMISSION_DENIED) await sendAlert();
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
        );
      }
    } else {
      navigator.geolocation.getCurrentPosition(
        () => { setLocationAlertSent(false); },
        async (err) => {
          if (err.code === err.PERMISSION_DENIED) await sendAlert();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
      );
    }
  };

  const statusConfig = {
    'not-clocked-in': { label: 'Not Clocked In', color: 'text-slate-500', bg: 'bg-slate-100', dot: 'bg-slate-400' },
    'clocked-in': { label: 'Present', color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
    'clocked-out': { label: 'Clocked Out', color: 'text-slate-600', bg: 'bg-slate-100', dot: 'bg-slate-400' },
  };

  const sc = statusConfig[state];

  const locationIcon = locationStatus === 'denied' || locationStatus === 'unavailable' ? (
    <WifiOff size={12} className="text-red-300" />
  ) : locationStatus === 'granted' ? (
    <Wifi size={12} className="text-emerald-300" />
  ) : locationStatus === 'requesting' ? (
    <span className="w-3 h-3 border border-blue-300 border-t-transparent rounded-full animate-spin inline-block" />
  ) : (
    <Wifi size={12} />
  );

  const locationLabel =
    travelApproved
    ? '✈️ Travel approved — no restrictions'
    : locationStatus === 'denied' ? 'Location denied — director notified'
    : locationStatus === 'unavailable' ? 'GPS unavailable'
    : locationStatus === 'granted' ? 'GPS recorded'
    : locationStatus === 'requesting' ? 'Getting location…'
    : locationSetting
    ? `Must be within ${locationSetting.radius_meters}m of ${locationSetting.office_name}`
    : 'Location will be recorded';

  return (
    <>
      <Toaster position="bottom-right" richColors />
      <div className="bg-gradient-to-r from-blue-700 to-blue-800 rounded-2xl p-4 sm:p-5 mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-600 ${sc.bg} ${sc.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${state === 'clocked-in' ? 'animate-pulse' : ''}`} />
              {sc.label}
            </span>
            <span className={`flex items-center gap-1 text-xs ${locationStatus === 'denied' ? 'text-red-300 font-semibold' : 'text-blue-200'}`}>
              {locationStatus === 'denied' ? <AlertTriangle size={12} className="text-red-300" /> : locationIcon}
              <span className="hidden sm:inline">{locationLabel}</span>
              <span className="sm:hidden">{locationStatus === 'denied' ? 'Location denied' : locationStatus === 'granted' ? 'GPS on' : 'Location'}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {clockInTime && (
              <div className="flex items-center gap-1.5 text-blue-100 text-sm">
                <LogIn size={14} className="text-blue-300" />
                <span className="text-blue-300 text-xs">In:</span>
                <span className="font-600 tabular-nums">{clockInTime}</span>
              </div>
            )}
            {clockOutTime && (
              <div className="flex items-center gap-1.5 text-blue-100 text-sm">
                <LogOut size={14} className="text-blue-300" />
                <span className="text-blue-300 text-xs">Out:</span>
                <span className="font-600 tabular-nums">{clockOutTime}</span>
              </div>
            )}
            {!clockInTime && (
              <div className="flex items-center gap-1.5 text-blue-200 text-sm">
                <Clock size={14} className="text-blue-300" />
                <span>Ready to clock in</span>
              </div>
            )}
            {currentLocation && (
              <div className="flex items-center gap-1.5 text-blue-200 text-sm">
                <MapPin size={14} className="text-blue-300" />
                <span className="tabular-nums text-xs hidden sm:inline">
                  {currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}
                </span>
                <span className="sm:hidden text-xs">GPS recorded</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {state === 'not-clocked-in' && (
            <button
              onClick={handleClockIn}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-3 bg-white text-blue-700 text-sm font-700 rounded-xl hover:bg-blue-50 active:scale-95 transition-all duration-150 disabled:opacity-70 shadow-sm min-h-[48px] min-w-[120px] justify-center"
            >
              {isLoading ? <span className="w-4 h-4 border-2 border-blue-700 border-t-transparent rounded-full animate-spin" /> : <LogIn size={16} />}
              Clock In
            </button>
          )}
          {state === 'clocked-in' && (
            <button
              onClick={handleClockOut}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-3 bg-red-500 text-white text-sm font-700 rounded-xl hover:bg-red-600 active:scale-95 transition-all duration-150 disabled:opacity-70 shadow-sm min-h-[48px] min-w-[120px] justify-center"
            >
              {isLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <LogOut size={16} />}
              Clock Out
            </button>
          )}
          {state === 'clocked-out' && (
            <div className="flex items-center gap-2 px-5 py-3 bg-white/10 text-white text-sm font-600 rounded-xl min-h-[48px]">
              <CheckCircle2 size={16} className="text-emerald-400" />
              Day Complete
            </div>
          )}
        </div>
      </div>
    </>
  );
}
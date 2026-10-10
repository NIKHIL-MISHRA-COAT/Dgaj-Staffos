'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, RefreshCw, Users, Clock, AlertTriangle, Navigation, Settings, Route, Save, X, Plus, Trash2, BellOff, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface EmployeeLocation {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
  event_type: string;
  device_name?: string;
  device_type?: string;
  user_profiles: {
    full_name: string;
    job_title: string;
    department: string;
    avatar_url: string;
    travel_approved?: boolean;
    firms?: { name: string; code: string } | null;
  };
}

interface RoutePoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

interface LocationSetting {
  id?: string;
  user_id: string;
  office_name: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
}

interface UserProfile {
  id: string;
  full_name: string;
  job_title: string;
  department: string;
}

interface LocationAlert {
  id: string;
  user_id: string;
  alert_type: string;
  message: string;
  resolved_at: string | null;
  created_at: string;
  user_profiles: {
    full_name: string;
    job_title: string;
    department: string;
    travel_approved?: boolean;
  };
}

function firmName(p: any): string {
  return p?.firms?.name || '';
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function LiveLocationMap() {
  const [locations, setLocations] = useState<EmployeeLocation[]>([]);
  const [deviceSessions, setDeviceSessions] = useState<Record<string, { device_label: string; platform: string; last_seen: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeLocation | null>(null);
  const [search, setSearch] = useState('');
  const matchesSearch = (p: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p?.full_name, p?.job_title, p?.department, firmName(p)]
      .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
  };
  const visibleLocations = locations.filter((l) => matchesSearch(l.user_profiles));
  const searchBox = (
    <input
      type="search"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search by employee or firm name…"
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
    />
  );
  const [mapUrl, setMapUrl] = useState<string>('');
  const [locationAlerts, setLocationAlerts] = useState<LocationAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  // Route tracking
  const [activeTab, setActiveTab] = useState<'live' | 'route' | 'settings'>('live');
  const [routeDate, setRouteDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [routeEmployee, setRouteEmployee] = useState<string>('');
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMapUrl, setRouteMapUrl] = useState<string>('');
  const [allEmployees, setAllEmployees] = useState<UserProfile[]>([]);

  // Location settings
  const [locationSettings, setLocationSettings] = useState<LocationSetting[]>([]);
  const visibleSettings = locationSettings.filter((st: any) => matchesSearch(st.user_profiles));
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editingSetting, setEditingSetting] = useState<LocationSetting | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSetting, setNewSetting] = useState<Omit<LocationSetting, 'id'>>({
    user_id: '',
    office_name: 'Office',
    center_latitude: 0,
    center_longitude: 0,
    radius_meters: 200,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [useMapPicker, setUseMapPicker] = useState(false);

  const { pinSession, user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const role = pinSession?.role || '';
  const isAuthorized = role === 'director';

  useEffect(() => {
    if (!isAuthorized) router.replace('/employee-dashboard');
  }, [isAuthorized]);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('employee_locations')
        .select(`
          id,
          user_id,
          latitude,
          longitude,
          accuracy,
          recorded_at,
          event_type,
          device_name,
          device_type,
          user_profiles (
            full_name,
            job_title,
            department,
            avatar_url,
            travel_approved,
            firms!firm_id(name, code)
          )
        `)
        .eq('is_active', true)
        .order('recorded_at', { ascending: false });

      if (fetchError) throw fetchError;

      // Deduplicate: keep latest location per user per device_type
      const seen = new Map<string, EmployeeLocation>();
      for (const loc of ((data as any) || [])) {
        const key = `${loc.user_id}-${loc.device_type || 'unknown'}`;
        if (!seen.has(key)) seen.set(key, loc);
      }
      setLocations(Array.from(seen.values()));
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to load employee locations');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllEmployees = useCallback(async () => {
    const { data } = await supabase
      .from('user_profiles')
      .select('id, full_name, job_title, department')
      .order('full_name');
    if (data) setAllEmployees(data as UserProfile[]);
  }, []);

  const fetchLocationSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const { data } = await supabase
        .from('location_settings')
        .select(`
          id, user_id, office_name, center_latitude, center_longitude, radius_meters,
          user_profiles (full_name, job_title, travel_approved, firms!firm_id(name, code))
        `)
        .order('created_at', { ascending: false });
      setLocationSettings((data as any) || []);
    } catch (err) {
      console.error('Failed to fetch location settings:', err);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const fetchLocationAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const { data } = await supabase
        .from('location_alerts')
        .select(`
          id, user_id, alert_type, message, resolved_at, created_at,
          user_profiles (full_name, job_title, department, travel_approved, firms!firm_id(name, code))
        `)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      // Filter out alerts for travel-approved employees
      const filtered = ((data as any) || []).filter(
        (a: LocationAlert) => !(a.user_profiles as any)?.travel_approved
      );
      setLocationAlerts(filtered);
    } catch (err) {
      console.error('Failed to fetch location alerts:', err);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const fetchDeviceSessions = useCallback(async () => {
    // Stale sessions (no heartbeat in 10+ min) get flagged inactive server-side;
    // this call is cheap and just nudges that check whenever a director has
    // the map open, so counts stay accurate without needing a cron job.
    await supabase.rpc('mark_stale_device_sessions');
    const { data } = await supabase
      .from('user_device_sessions')
      .select('user_id, device_label, platform, last_seen')
      .eq('is_active', true)
      .order('last_seen', { ascending: false });
    if (!data) return;
    const grouped: Record<string, { device_label: string; platform: string; last_seen: string }[]> = {};
    data.forEach((row: any) => {
      if (!grouped[row.user_id]) grouped[row.user_id] = [];
      grouped[row.user_id].push(row);
    });
    setDeviceSessions(grouped);
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;
    fetchLocations();
    fetchAllEmployees();
    fetchLocationSettings();
    fetchLocationAlerts();
    fetchDeviceSessions();
    // 60s poll kept as a safety net in case a realtime event is missed
    // (e.g. brief disconnect), but the channel below is what makes the
    // map feel live — updates typically land within a second or two.
    const interval = setInterval(() => {
      fetchLocations();
      fetchLocationAlerts();
    }, 60000);
    return () => clearInterval(interval);
  }, [isAuthorized, fetchLocations, fetchAllEmployees, fetchLocationSettings, fetchLocationAlerts, fetchDeviceSessions]);

  // Real-time: push new/updated employee positions and alerts to the map the
  // moment they land in the database, instead of waiting for the next poll.
  useEffect(() => {
    if (!isAuthorized) return;

    const channel = supabase
      .channel('live-location-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_locations' }, () => {
        fetchLocations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'location_alerts' }, () => {
        fetchLocationAlerts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_device_sessions' }, () => {
        fetchDeviceSessions();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthorized, fetchDeviceSessions]);

  // Build live map URL
  useEffect(() => {
    if (locations.length === 0) { setMapUrl(''); return; }
    const target = selectedEmployee || locations[0];
    setMapUrl(`https://maps.google.com/maps?q=${target.latitude},${target.longitude}&z=15&output=embed`);
  }, [locations, selectedEmployee]);

  // Build route map URL using Google Maps Directions/waypoints embed
  useEffect(() => {
    if (routePoints.length === 0) { setRouteMapUrl(''); return; }
    if (routePoints.length === 1) {
      setRouteMapUrl(`https://maps.google.com/maps?q=${routePoints[0].latitude},${routePoints[0].longitude}&z=15&output=embed`);
      return;
    }
    const origin = `${routePoints[0].latitude},${routePoints[0].longitude}`;
    const destination = `${routePoints[routePoints.length - 1].latitude},${routePoints[routePoints.length - 1].longitude}`;
    const waypoints = routePoints
      .slice(1, -1)
      .slice(0, 8) // Google Maps embed supports up to 8 waypoints
      .map((p) => `${p.latitude},${p.longitude}`)
      .join('|');
    const waypointParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
    setRouteMapUrl(
      `https://www.google.com/maps/embed/v1/directions?key=AIzaSyD-placeholder&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointParam}&mode=driving`
    );
    // Fallback: use static map showing all points
    const allPoints = routePoints.map((p) => `${p.latitude},${p.longitude}`).join('|');
    setRouteMapUrl(
      `https://maps.google.com/maps?q=${routePoints[0].latitude},${routePoints[0].longitude}&z=13&output=embed`
    );
  }, [routePoints]);

  const fetchRouteForEmployee = async () => {
    if (!routeEmployee || !routeDate) return;
    setRouteLoading(true);
    try {
      const { data, error: routeErr } = await supabase
        .from('route_tracking')
        .select('latitude, longitude, recorded_at')
        .eq('user_id', routeEmployee)
        .eq('work_date', routeDate)
        .order('recorded_at', { ascending: true });

      if (routeErr) throw routeErr;
      setRoutePoints((data as RoutePoint[]) || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load route data');
    } finally {
      setRouteLoading(false);
    }
  };

  const handleSaveNewSetting = async () => {
    if (!newSetting.user_id || !newSetting.center_latitude || !newSetting.center_longitude) {
      setError('Please fill in all required fields including coordinates.');
      return;
    }
    setSavingSettings(true);
    try {
      const { error: saveErr } = await supabase
        .from('location_settings')
        .upsert(
          { ...newSetting, created_by: user?.id },
          { onConflict: 'user_id' }
        );
      if (saveErr) throw saveErr;
      setShowAddForm(false);
      setNewSetting({ user_id: '', office_name: 'Office', center_latitude: 0, center_longitude: 0, radius_meters: 200 });
      await fetchLocationSettings();
    } catch (err: any) {
      setError(err?.message || 'Failed to save location setting');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleTravel = async (userId: string, current: boolean) => {
    const callerId = user?.id || pinSession?.userId || null;
    if (!callerId) { setError('Not authenticated'); return; }
    setSavingSettings(true);
    try {
      const res = await fetch('/api/director-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_travel', userId, callerId, updates: { travel_approved: !current } }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not update travel status');
      await Promise.all([fetchLocationSettings(), fetchLocationAlerts()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to update travel status');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUpdateSetting = async () => {
    if (!editingSetting) return;
    setSavingSettings(true);
    try {
      const { error: updateErr } = await supabase
        .from('location_settings')
        .update({
          office_name: editingSetting.office_name,
          center_latitude: editingSetting.center_latitude,
          center_longitude: editingSetting.center_longitude,
          radius_meters: editingSetting.radius_meters,
        })
        .eq('id', editingSetting.id);
      if (updateErr) throw updateErr;
      setEditingSetting(null);
      await fetchLocationSettings();
    } catch (err: any) {
      setError(err?.message || 'Failed to update location setting');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteSetting = async (id: string) => {
    try {
      await supabase.from('location_settings').delete().eq('id', id);
      await fetchLocationSettings();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete setting');
    }
  };

  const resolveAlert = async (alertId: string) => {
    try {
      await supabase
        .from('location_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', alertId);
      setLocationAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err: any) {
      setError(err?.message || 'Failed to resolve alert');
    }
  };

  if (!isAuthorized) return null;

  return (
          <div className="p-4 md:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Navigation size={22} className="text-blue-600" />
              Live Employee Locations
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Showing {locations.length} active employee{locations.length !== 1 ? 's' : ''} · Last updated {timeAgo(lastRefresh.toISOString())}
            </p>
          </div>
          <button
            onClick={fetchLocations}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-5">
            <AlertTriangle size={16} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1 w-fit">
          {(['live', 'route', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors capitalize ${
                activeTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'live' && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />Live Map</span>}
              {tab === 'route' && <span className="flex items-center gap-1.5"><Route size={14} />Route Tracking</span>}
              {tab === 'settings' && <span className="flex items-center gap-1.5"><Settings size={14} />Location Settings</span>}
            </button>
          ))}
        </div>

        {/* ── LIVE MAP TAB ── */}
        {activeTab === 'live' && (
          <div className="space-y-5">
            {/* Location Alerts Banner */}
            {locationAlerts.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BellOff size={16} className="text-red-600" />
                  <span className="text-sm font-bold text-red-700">Location Services Disabled Alerts</span>
                  <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{locationAlerts.length} active</span>
                </div>
                <div className="space-y-2">
                  {locationAlerts.map((alert) => (
                    <div key={alert.id} className="flex items-center gap-3 bg-white rounded-xl border border-red-100 px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <BellOff size={14} className="text-red-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{(alert.user_profiles as any)?.full_name || 'Employee'}</p>
                        <p className="text-xs text-slate-500">{[firmName(alert.user_profiles), (alert.user_profiles as any)?.job_title].filter(Boolean).join(' · ')} · {timeAgo(alert.created_at)}</p>
                        <p className="text-xs text-red-600 mt-0.5">⚠️ Location services turned off while clocked in</p>
                      </div>
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        title="Mark as resolved"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
                      >
                        <CheckCircle size={12} />
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Employee List */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <Users size={16} className="text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">Active Employees</span>
                    <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{visibleLocations.length}</span>
                  </div>
                  <div className="px-4 py-3 border-b border-slate-100">{searchBox}</div>
                  {loading && locations.length === 0 ? (
                    <div className="p-6 text-center">
                      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm text-slate-500">Loading locations…</p>
                    </div>
                  ) : visibleLocations.length === 0 ? (
                    <div className="p-6 text-center">
                      <MapPin size={32} className="text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-slate-600">No active employees</p>
                      <p className="text-xs text-slate-400 mt-1">Employees appear here when they clock in with GPS enabled</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                      {visibleLocations.length === 0 && (
                        <p className="p-4 text-sm text-slate-500 text-center">No employees match “{search}”</p>
                      )}
                      {visibleLocations.map((loc) => {
                        const name = loc.user_profiles?.full_name || 'Unknown';
                        const isSelected = selectedEmployee?.id === loc.id;
                        return (
                          <button
                            key={loc.id}
                            onClick={() => setSelectedEmployee(isSelected ? null : loc)}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                          >
                            <div className="w-9 h-9 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {getInitials(name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                              <p className="text-xs text-slate-500 truncate">{[firmName(loc.user_profiles) || 'No firm assigned', loc.user_profiles?.job_title || loc.user_profiles?.department || 'Employee'].filter(Boolean).join(' · ')}</p>
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-xs text-emerald-600 font-medium">Clocked in · {timeAgo(loc.recorded_at)}</span>
                                {loc.device_type && (
                                  <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ml-1 ${loc.device_type === 'mobile' ? 'bg-blue-100 text-blue-700' : loc.device_type === 'desktop' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {loc.device_type === 'mobile' ? '📱' : loc.device_type === 'desktop' ? '💻' : '📟'} {loc.device_name || loc.device_type}
                                  </span>
                                )}
                                {(deviceSessions[loc.user_id]?.length ?? 0) > 1 && (
                                  <span
                                    title={deviceSessions[loc.user_id].map((d) => d.device_label).join(' · ')}
                                    className="text-[10px] font-600 px-1.5 py-0.5 rounded-full ml-1 bg-amber-100 text-amber-700"
                                  >
                                    ⚠️ {deviceSessions[loc.user_id].length} devices logged in
                                  </span>
                                )}
                              </div>
                            </div>
                            <MapPin size={14} className={isSelected ? 'text-blue-500' : 'text-slate-300'} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Map Panel */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <MapPin size={16} className="text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">
                      {selectedEmployee
                        ? `${selectedEmployee.user_profiles?.full_name || 'Employee'}'s Location${firmName(selectedEmployee.user_profiles) ? ` · ${firmName(selectedEmployee.user_profiles)}` : ''}`
                        : locations.length > 0
                        ? 'Most Recent Active Location' :'Map View'}
                    </span>
                    {selectedEmployee && (
                      <button
                        onClick={() => setSelectedEmployee(null)}
                        className="ml-auto text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        Show all
                      </button>
                    )}
                  </div>

                  {mapUrl ? (
                    <div className="relative">
                      <iframe
                        src={mapUrl}
                        width="100%"
                        height="420"
                        style={{ border: 0 }}
                        allowFullScreen
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        title="Employee Location Map"
                        className="w-full"
                      />
                      {(selectedEmployee || locations[0]) && (
                        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow text-xs text-slate-700 flex items-center gap-1.5">
                          <MapPin size={12} className="text-blue-600" />
                          {(selectedEmployee || locations[0]).latitude.toFixed(5)}, {(selectedEmployee || locations[0]).longitude.toFixed(5)}
                          {(selectedEmployee || locations[0]).accuracy && (
                            <span className="text-slate-400 ml-1">±{Math.round((selectedEmployee || locations[0]).accuracy!)}m</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-[420px] flex flex-col items-center justify-center bg-slate-50">
                      <MapPin size={48} className="text-slate-200 mb-3" />
                      <p className="text-sm font-medium text-slate-500">No location data available</p>
                      <p className="text-xs text-slate-400 mt-1 text-center max-w-xs px-4">
                        Employees need to clock in with location permissions enabled for their position to appear here
                      </p>
                    </div>
                  )}
                </div>

                {/* Location cards grid for multiple employees */}
                {locations.length > 1 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {visibleLocations.slice(0, 6).map((loc) => {
                      const name = loc.user_profiles?.full_name || 'Unknown';
                      return (
                        <button
                          key={`card-${loc.id}`}
                          onClick={() => setSelectedEmployee(loc)}
                          className={`bg-white rounded-xl border p-3 text-left transition-all hover:shadow-md ${selectedEmployee?.id === loc.id ? 'border-blue-400 shadow-md' : 'border-slate-200'}`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {getInitials(name)}
                            </div>
                            <span className="min-w-0"><span className="block text-xs font-semibold text-slate-800 truncate">{name.split(' ')[0]}</span>{firmName(loc.user_profiles) && <span className="block text-[10px] text-slate-500 truncate">{firmName(loc.user_profiles)}</span>}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock size={10} className="text-slate-400" />
                            <span className="text-xs text-slate-500">{timeAgo(loc.recorded_at)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ROUTE TRACKING TAB ── */}
        {activeTab === 'route' && (
          <div className="space-y-5">
            {/* Controls */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Route size={16} className="text-blue-600" />
                View Employee Day Route
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee</label>
                  <select
                    value={routeEmployee}
                    onChange={(e) => setRouteEmployee(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select employee…</option>
                    {allEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={routeDate}
                    onChange={(e) => setRouteDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={fetchRouteForEmployee}
                    disabled={!routeEmployee || !routeDate || routeLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                  >
                    {routeLoading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Route size={15} />}
                    Load Route
                  </button>
                </div>
              </div>
            </div>

            {/* Route Results */}
            {routePoints.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Timeline */}
                <div className="lg:col-span-1">
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">Route Timeline</span>
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{routePoints.length} points</span>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                      {routePoints.map((point, idx) => (
                        <div key={idx} className="flex items-start gap-3 px-4 py-3">
                          <div className="flex flex-col items-center mt-1">
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${idx === 0 ? 'bg-emerald-500' : idx === routePoints.length - 1 ? 'bg-red-500' : 'bg-blue-400'}`} />
                            {idx < routePoints.length - 1 && <div className="w-0.5 h-6 bg-slate-200 mt-1" />}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-700">{formatTime(point.recorded_at)}</p>
                            <p className="text-xs text-slate-400 tabular-nums">{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</p>
                            {idx === 0 && <span className="text-xs text-emerald-600 font-medium">Start</span>}
                            {idx === routePoints.length - 1 && <span className="text-xs text-red-500 font-medium">End</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Route Map */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <span className="text-sm font-semibold text-slate-700">
                        Route Map · {new Date(routeDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="relative">
                      <iframe
                        src={`https://maps.google.com/maps?q=${routePoints[0].latitude},${routePoints[0].longitude}&z=13&output=embed`}
                        width="100%"
                        height="420"
                        style={{ border: 0 }}
                        allowFullScreen
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        title="Employee Route Map"
                        className="w-full"
                      />
                      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow text-xs text-slate-700 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Start: {formatTime(routePoints[0].recorded_at)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          <span>End: {formatTime(routePoints[routePoints.length - 1].recorded_at)}</span>
                        </div>
                        <div className="text-slate-400">{routePoints.length} GPS points recorded</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {routePoints.length === 0 && !routeLoading && routeEmployee && (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <Route size={40} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-600">No route data for this date</p>
                <p className="text-xs text-slate-400 mt-1">Route tracking records GPS breadcrumbs every 5 minutes while an employee is clocked in</p>
              </div>
            )}
          </div>
        )}

        {/* ── LOCATION SETTINGS TAB ── */}
        {activeTab === 'settings' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Clock-In Radius Settings</h2>
                <p className="text-xs text-slate-500 mt-0.5">Set a GPS location and radius for each employee. They must be within the radius to clock in.</p>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <Plus size={15} />
                Add Setting
              </button>
            </div>

            {/* Add Form */}
            {showAddForm && (
              <div className="bg-white rounded-2xl border border-blue-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">New Location Setting</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee *</label>
                    <select
                      value={newSetting.user_id}
                      onChange={(e) => setNewSetting({ ...newSetting, user_id: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select employee…</option>
                      {allEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Office / Location Name</label>
                    <input
                      type="text"
                      value={newSetting.office_name}
                      onChange={(e) => setNewSetting({ ...newSetting, office_name: e.target.value })}
                      placeholder="e.g. Head Office"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Center Latitude *</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={newSetting.center_latitude || ''}
                      onChange={(e) => setNewSetting({ ...newSetting, center_latitude: parseFloat(e.target.value) || 0 })}
                      placeholder="e.g. 28.613939"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Center Longitude *</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={newSetting.center_longitude || ''}
                      onChange={(e) => setNewSetting({ ...newSetting, center_longitude: parseFloat(e.target.value) || 0 })}
                      placeholder="e.g. 77.209021"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Allowed Radius (meters)</label>
                    <input
                      type="number"
                      min="50"
                      max="5000"
                      value={newSetting.radius_meters}
                      onChange={(e) => setNewSetting({ ...newSetting, radius_meters: parseInt(e.target.value) || 200 })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">Recommended: 100–500m for office, 1000–5000m for field workers</p>
                  </div>
                  <div className="flex items-end">
                    <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 w-full">
                      <p className="font-medium mb-1">💡 How to get coordinates</p>
                      <p>1. Open Google Maps</p>
                      <p>2. Right-click on the office location</p>
                      <p>3. Click the coordinates shown at the top</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleSaveNewSetting}
                    disabled={savingSettings}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                  >
                    {savingSettings ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                    Save Setting
                  </button>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Settings List */}
            {settingsLoading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-slate-500">Loading settings…</p>
              </div>
            ) : locationSettings.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <Settings size={40} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-600">No location settings configured</p>
                <p className="text-xs text-slate-400 mt-1">Add a setting to enforce GPS-based clock-in radius for employees</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-3">{searchBox}</div>
                {visibleSettings.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">No boundary settings match “{search}”</p>
                )}
                {visibleSettings.map((setting: any) => (
                  <div key={setting.id} className="bg-white rounded-2xl border border-slate-200 p-5">
                    {editingSetting?.id === setting.id ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5">Office Name</label>
                            <input
                              type="text"
                              value={editingSetting.office_name}
                              onChange={(e) => setEditingSetting({ ...editingSetting, office_name: e.target.value })}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5">Radius (meters)</label>
                            <input
                              type="number"
                              value={editingSetting.radius_meters}
                              onChange={(e) => setEditingSetting({ ...editingSetting, radius_meters: parseInt(e.target.value) || 200 })}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5">Latitude</label>
                            <input
                              type="number"
                              step="0.000001"
                              value={editingSetting.center_latitude}
                              onChange={(e) => setEditingSetting({ ...editingSetting, center_latitude: parseFloat(e.target.value) || 0 })}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1.5">Longitude</label>
                            <input
                              type="number"
                              step="0.000001"
                              value={editingSetting.center_longitude}
                              onChange={(e) => setEditingSetting({ ...editingSetting, center_longitude: parseFloat(e.target.value) || 0 })}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={handleUpdateSetting}
                            disabled={savingSettings}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
                          >
                            {savingSettings ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
                            Save
                          </button>
                          <button onClick={() => setEditingSetting(null)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <MapPin size={18} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{setting.user_profiles?.full_name || 'Unknown Employee'}</p>
                            <p className="text-xs text-slate-500">{[firmName(setting.user_profiles), setting.user_profiles?.job_title].filter(Boolean).join(' · ')}</p>
                            <div className="flex flex-wrap gap-3 mt-2">
                              <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                                <MapPin size={10} />
                                {setting.office_name}
                              </span>
                              {setting.user_profiles?.travel_approved ? (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg">
                                  ✈ Free from boundary (travelling)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg">
                                  ⊙ {setting.radius_meters}m radius
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 text-xs bg-slate-50 text-slate-500 px-2 py-1 rounded-lg font-mono">
                                {setting.center_latitude.toFixed(5)}, {setting.center_longitude.toFixed(5)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => toggleTravel(setting.user_id, !!setting.user_profiles?.travel_approved)}
                            disabled={savingSettings}
                            title={setting.user_profiles?.travel_approved ? 'Enforce radius again' : 'Free this employee from the radius (travelling)'}
                            className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${setting.user_profiles?.travel_approved ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                          >
                            {setting.user_profiles?.travel_approved ? 'Enforce radius' : 'Travelling'}
                          </button>
                          <button
                            onClick={() => setEditingSetting(setting)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Settings size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteSetting(setting.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  );
}

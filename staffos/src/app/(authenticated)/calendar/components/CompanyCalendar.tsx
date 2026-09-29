'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Repeat, Clock, Building2, X, Calendar, BellRing, ChevronDown, Tag, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';

type EventType = 'meeting' | 'task' | 'reminder' | 'holiday' | 'review' | 'payroll';
type RecurringType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type PriorityType = 'low' | 'medium' | 'high' | 'urgent';

interface CalendarEvent {
  id: string;
  title: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  event_type: EventType;
  recurring: RecurringType;
  department?: string;
  attendees?: string[];
  description?: string;
  reminder_minutes?: number;
  priority?: PriorityType;
  created_by?: string;
}

const eventTypeConfig: Record<EventType, { label: string; color: string; bg: string; dot: string }> = {
  meeting: { label: 'Meeting', color: 'text-blue-700', bg: 'bg-blue-100', dot: 'bg-blue-500' },
  task: { label: 'Task', color: 'text-purple-700', bg: 'bg-purple-100', dot: 'bg-purple-500' },
  reminder: { label: 'Reminder', color: 'text-amber-700', bg: 'bg-amber-100', dot: 'bg-amber-500' },
  holiday: { label: 'Holiday', color: 'text-emerald-700', bg: 'bg-emerald-100', dot: 'bg-emerald-500' },
  review: { label: 'Review', color: 'text-rose-700', bg: 'bg-rose-100', dot: 'bg-rose-500' },
  payroll: { label: 'Salary Day', color: 'text-green-700', bg: 'bg-green-100', dot: 'bg-green-500' },
};

const priorityConfig: Record<PriorityType, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',    color: 'text-slate-600',   bg: 'bg-slate-100'   },
  medium: { label: 'Medium', color: 'text-amber-700',   bg: 'bg-amber-100'   },
  high:   { label: 'High',   color: 'text-orange-700',  bg: 'bg-orange-100'  },
  urgent: { label: 'Urgent', color: 'text-red-700',     bg: 'bg-red-100'     },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const departments = ['All', 'Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'HR & Operations', 'Finance', 'Customer Support'];

interface NewEventForm {
  title: string;
  date: string;
  time: string;
  endTime: string;
  type: EventType;
  recurring: RecurringType;
  department: string;
  description: string;
  reminder: number;
  priority: PriorityType;
}

const defaultForm: NewEventForm = {
  title: '', date: '', time: '', endTime: '', type: 'meeting',
  recurring: 'none', department: 'All', description: '', reminder: 15, priority: 'medium',
};

export default function CompanyCalendar() {
  const [currentMonth, setCurrentMonth] = useState(0);
  const [currentYear, setCurrentYear] = useState(2024);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [todayDate, setTodayDate] = useState<{ d: number; m: number; y: number } | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEvent, setNewEvent] = useState<NewEventForm>(defaultForm);
  const [deptFilter, setDeptFilter] = useState('All');
  const { user, effectiveUserId } = useAuth();
  const supabase = createClient();

  useEffect(() => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setSelectedDate(now.getDate());
    setTodayDate({ d: now.getDate(), m: now.getMonth(), y: now.getFullYear() });
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [currentMonth, currentYear, effectiveUserId]);

  // Real-time sync: refresh the calendar whenever calendar events, tasks, leave
  // requests, or holidays change — for this user or anyone else on the team.
  useEffect(() => {
    if (!effectiveUserId) return;

    const scheduleRefresh = (() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        // Debounce bursts of change events (e.g. bulk task updates) into one refetch.
        timer = setTimeout(() => fetchEvents(), 400);
      };
    })();

    const channel = supabase
      .channel(`calendar-live-${effectiveUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_holidays' }, () => {
        scheduleRefresh();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [effectiveUserId]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
      const monthEnd = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
      const uid = effectiveUserId;

      // Fetch calendar events (user-specific + all-department) — include recurring events from any date
      const { data: visibleFirmIds } = uid ? await supabase.rpc('get_visible_firm_ids', { p_user_id: uid, p_module: 'calendar' }) : { data: null };
      let calQuery = supabase
        .from('calendar_events')
        .select('*')
        .or(`event_date.gte.${monthStart},recurring.neq.none`)
        .order('event_date', { ascending: true });
      if (visibleFirmIds) calQuery = calQuery.in('firm_id', visibleFirmIds);
      const { data: calData, error } = await calQuery;

      if (error) throw error;

      // Fetch ALL tasks assigned to this user for the month — including past (completed/overdue)
      let taskEvents: CalendarEvent[] = [];
      if (uid) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, title, due_date, due_time, priority, status, task_category, recurring')
          .or(`assigned_to_user_id.eq.${uid},assigned_user_ids.cs.{${uid}}`)
          .gte('due_date', monthStart)
          .lte('due_date', monthEnd);
        // Note: removed .neq('status', 'done') so completed tasks also appear in calendar history

        taskEvents = (tasks || []).map((t: any) => ({
          id: `task-${t.id}`,
          title: `📋 ${t.title}`,
          event_date: t.due_date,
          start_time: t.due_time || undefined,
          event_type: 'task' as EventType,
          recurring: (t.recurring as RecurringType) || 'none',
          description: `${t.status === 'done' ? '✅ Completed' : t.status === 'overdue' ? '⚠️ Overdue' : `Task · ${t.task_category || 'general'}`}`,
          priority: (t.priority === 'critical' ? 'urgent' : t.priority) as PriorityType,
          created_by: uid,
        }));
      }

      // Fetch company holidays
      const { data: holidays } = await supabase
        .from('company_holidays')
        .select('*')
        .gte('holiday_date', monthStart)
        .lte('holiday_date', monthEnd);

      const holidayEvents: CalendarEvent[] = (holidays || []).map((h: any) => ({
        id: `holiday-${h.id}`,
        title: `🎉 ${h.name}`,
        event_date: h.holiday_date,
        event_type: 'holiday' as EventType,
        recurring: h.is_recurring ? 'yearly' as RecurringType : 'none' as RecurringType,
        description: h.holiday_type || 'Public Holiday',
        created_by: h.created_by,
      }));

      // Fetch approved leave for this user in the month
      let leaveEvents: CalendarEvent[] = [];
      if (uid) {
        const { data: leaves } = await supabase
          .from('leave_requests')
          .select('id, leave_type, start_date, end_date, status')
          .eq('user_id', uid)
          .in('status', ['approved', 'pending'])
          .or(`start_date.lte.${monthEnd},end_date.gte.${monthStart}`);

        (leaves || []).forEach((leave: any) => {
          // Create an event for each day of the leave within the month
          const start = new Date(leave.start_date);
          const end = new Date(leave.end_date);
          const cur = new Date(start);
          while (cur <= end) {
            const dateStr = cur.toISOString().split('T')[0];
            if (dateStr >= monthStart && dateStr <= monthEnd) {
              leaveEvents.push({
                id: `leave-${leave.id}-${dateStr}`,
                title: `🏖️ ${leave.leave_type.replace('_', ' ')} Leave`,
                event_date: dateStr,
                event_type: 'reminder' as EventType,
                recurring: 'none' as RecurringType,
                description: leave.status === 'approved' ? 'Approved Leave' : 'Pending Leave',
                created_by: uid,
              });
            }
            cur.setDate(cur.getDate() + 1);
          }
        });
      }

      // Recurring "Salary Day" marker, driven by the Payroll setting in Firm
      // Configuration (director_settings.setting_key = 'salary_schedule').
      // Synthetic — not a real calendar_events row — so it always reflects
      // the current setting even for past months without needing backfill.
      let payrollEvents: CalendarEvent[] = [];
      const { data: salarySetting } = await supabase
        .from('director_settings')
        .select('setting_value')
        .eq('setting_key', 'salary_schedule')
        .maybeSingle();
      const dayOfMonth = salarySetting?.setting_value?.day_of_month;
      if (dayOfMonth) {
        const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
        const actualDay = Math.min(dayOfMonth, lastDay); // e.g. "31st" falls back to month-end in a 30-day month
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
        payrollEvents = [{
          id: `salary-${currentYear}-${currentMonth}`,
          title: `💰 ${salarySetting.setting_value.label || 'Salary Day'}`,
          event_date: dateStr,
          event_type: 'payroll' as EventType,
          recurring: 'monthly' as RecurringType,
          description: 'Monthly salary disbursement',
        }];
      }

      setEvents([...(calData || []), ...taskEvents, ...holidayEvents, ...leaveEvents, ...payrollEvents]);
    } catch (err) {
      console.error('Calendar fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const getEventsForDay = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();

    return events.filter((e) => {
      const eDate = new Date(e.event_date);
      const eDay = eDate.getUTCDate();
      const eMonth = eDate.getUTCMonth();
      const eYear = eDate.getUTCFullYear();
      const eWeekDay = new Date(e.event_date).getDay();

      const matchDate = e.event_date === dateStr;
      const matchRecurring =
        e.recurring === 'daily' ||
        (e.recurring === 'weekly' && dayOfWeek === eWeekDay) ||
        (e.recurring === 'monthly' && eDay === day) ||
        (e.recurring === 'yearly' && eDay === day && eMonth === currentMonth);
      const matchDept = deptFilter === 'All' || !e.department || e.department === 'All' || e.department === deptFilter;
      return (matchDate || matchRecurring) && matchDept;
    });
  };

  const selectedDayEvents = selectedDate ? getEventsForDay(selectedDate) : [];

  const handleCreateEvent = async () => {
    if (!newEvent.title.trim()) { toast.error('Event title is required'); return; }
    const uid = effectiveUserId;
    if (!uid) { toast.error('Please log in to add events'); return; }
    setSaving(true);
    try {
      const eventDate = newEvent.date || `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(selectedDate || 1).padStart(2, '0')}`;
      const { data: creatorProfile } = await supabase.from('user_profiles').select('firm_id').eq('id', uid).single();
      const payload: Record<string, any> = {
        title: newEvent.title,
        description: newEvent.description,
        event_date: eventDate,
        firm_id: creatorProfile?.firm_id || null,
        start_time: newEvent.time || null,
        end_time: newEvent.endTime || null,
        event_type: newEvent.type,
        recurring: newEvent.recurring,
        department: newEvent.department,
        reminder_minutes: newEvent.reminder,
        created_by: uid,
      };

      // Try to add priority field — if column doesn't exist, it will be ignored gracefully
      try {
        const { data, error } = await supabase.from('calendar_events').insert({ ...payload, priority: newEvent.priority }).select().single();
        if (error) {
          // If priority column doesn't exist, retry without it
          if (error.message?.includes('priority')) {
            const { data: data2, error: error2 } = await supabase.from('calendar_events').insert(payload).select().single();
            if (error2) throw error2;
            setEvents((prev) => [...prev, data2]);
          } else {
            throw error;
          }
        } else {
          setEvents((prev) => [...prev, data]);
        }
      } catch (innerErr: any) {
        throw innerErr;
      }

      setNewEvent(defaultForm);
      setShowNewEvent(false);
      toast.success('Event added to calendar!', { duration: 3000 });
    } catch (err: any) {
      toast.error(err.message || 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    try {
      await supabase.from('calendar_events').delete().eq('id', id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
      toast.success('Event removed');
    } catch {
      toast.error('Failed to delete event');
    }
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-6 lg:px-8 py-6">
      <Toaster position="bottom-right" richColors />

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-700 text-slate-900 dark:text-slate-100">Company Calendar</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Shared calendar — accessible to all roles</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Building2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
              className="input-field pl-8 pr-8 py-2 text-sm appearance-none cursor-pointer min-w-[160px]">
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <button onClick={() => setShowNewEvent(true)} className="btn-primary py-2.5 px-4 flex items-center gap-2">
            <Plus size={16} /><span>Add Event</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Calendar Grid */}
        <div className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <ChevronLeft size={18} className="text-slate-600 dark:text-slate-400" />
            </button>
            <h2 className="text-base font-700 text-slate-900 dark:text-slate-100">{MONTHS[currentMonth]} {currentYear}</h2>
            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <ChevronRight size={18} className="text-slate-600 dark:text-slate-400" />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-700">
            {DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-600 text-slate-400 uppercase tracking-wider">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-slate-50 dark:border-slate-700" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = getEventsForDay(day);
              const isToday = todayDate !== null && day === todayDate.d && currentMonth === todayDate.m && currentYear === todayDate.y;
              const isSelected = day === selectedDate;
              return (
                <div key={`day-${day}`}
                  onClick={() => setSelectedDate(day)}
                  className={`min-h-[80px] border-b border-r border-slate-50 dark:border-slate-700 p-1.5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-600 mb-1 ${isToday ? 'bg-blue-600 text-white' : isSelected ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map((ev) => {
                      const cfg = eventTypeConfig[ev.event_type];
                      return (
                        <div key={ev.id} className={`text-[10px] font-500 px-1 py-0.5 rounded truncate ${cfg.bg} ${cfg.color}`}>
                          {ev.recurring !== 'none' && <Repeat size={8} className="inline mr-0.5" />}
                          {ev.title}
                        </div>
                      );
                    })}
                    {dayEvents.length > 2 && (
                      <div className="text-[10px] text-slate-400 font-500 px-1">+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Selected Day Events */}
        <div className="space-y-4">
          {/* Legend */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-xs font-700 text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">Event Types</h3>
            <div className="space-y-1.5">
              {(Object.keys(eventTypeConfig) as EventType[]).map((type) => {
                const cfg = eventTypeConfig[type];
                return (
                  <div key={type} className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                    <span className="text-xs text-slate-600 dark:text-slate-400">{cfg.label}</span>
                    <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">{events.filter((e) => e.event_type === type).length} events</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Day */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
              <h3 className="text-sm font-700 text-slate-900 dark:text-slate-100">
                {selectedDate ? `${MONTHS[currentMonth]} ${selectedDate}` : 'Select a date'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-slate-700 max-h-[400px] overflow-y-auto">
              {selectedDayEvents.length === 0 && (
                <div className="py-8 text-center">
                  <Calendar size={28} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 dark:text-slate-500">No events this day</p>
                  <button onClick={() => setShowNewEvent(true)} className="text-xs text-blue-600 font-600 mt-2 hover:underline">
                    + Add event
                  </button>
                </div>
              )}
              {selectedDayEvents.map((ev) => {
                const cfg = eventTypeConfig[ev.event_type];
                const pCfg = ev.priority ? priorityConfig[ev.priority] : null;
                return (
                  <div key={ev.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                    <div className="flex items-start gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} mt-1.5 flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-600 text-slate-900 dark:text-slate-100">{ev.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                          {pCfg && (
                            <span className={`text-[10px] font-600 px-1.5 py-0.5 rounded-full ${pCfg.bg} ${pCfg.color}`}>
                              <AlertTriangle size={8} className="inline mr-0.5" />{pCfg.label}
                            </span>
                          )}
                          {ev.recurring !== 'none' && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                              <Repeat size={9} />{ev.recurring}
                            </span>
                          )}
                          {ev.start_time && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                              <Clock size={9} />{String(ev.start_time).slice(0, 5)}{ev.end_time ? ` – ${String(ev.end_time).slice(0, 5)}` : ''}
                            </span>
                          )}
                        </div>
                        {ev.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{ev.description}</p>}
                        {ev.department && ev.department !== 'All' && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{ev.department}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(ev.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                      >
                        <X size={12} className="text-slate-400 hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* New Event Modal */}
      {showNewEvent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-base font-700 text-slate-900 dark:text-slate-100">Add Calendar Event</h3>
              <button onClick={() => setShowNewEvent(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Event Title *</label>
                <input type="text" placeholder="What's happening?" value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="input-field" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Event Type</label>
                  <div className="relative">
                    <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select value={newEvent.type} onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value as EventType })}
                      className="input-field pl-8 appearance-none cursor-pointer">
                      {(Object.keys(eventTypeConfig) as EventType[]).map((t) => (
                        <option key={t} value={t}>{eventTypeConfig[t].label}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Priority</label>
                  <div className="relative">
                    <AlertTriangle size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select value={newEvent.priority} onChange={(e) => setNewEvent({ ...newEvent, priority: e.target.value as PriorityType })}
                      className="input-field pl-8 appearance-none cursor-pointer">
                      {(Object.keys(priorityConfig) as PriorityType[]).map((p) => (
                        <option key={p} value={p}>{priorityConfig[p].label}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Recurring</label>
                  <div className="relative">
                    <Repeat size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select value={newEvent.recurring} onChange={(e) => setNewEvent({ ...newEvent, recurring: e.target.value as RecurringType })}
                      className="input-field pl-8 appearance-none cursor-pointer">
                      <option value="none">One-time</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Date</label>
                  <div className="relative">
                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                      className="input-field pl-8" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Start Time</label>
                  <div className="relative">
                    <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="time" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                      className="input-field pl-8" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">End Time</label>
                  <div className="relative">
                    <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="time" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                      className="input-field pl-8" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Department</label>
                <div className="relative">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select value={newEvent.department} onChange={(e) => setNewEvent({ ...newEvent, department: e.target.value })}
                    className="input-field pl-8 appearance-none cursor-pointer">
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">
                  <BellRing size={12} className="inline mr-1" />Reminder (minutes before)
                </label>
                <div className="flex gap-2">
                  {[5, 15, 30, 60].map((m) => (
                    <button key={m} onClick={() => setNewEvent({ ...newEvent, reminder: m })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-600 border transition-all ${newEvent.reminder === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-blue-300'}`}>
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-600 text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                <textarea placeholder="Add details…" value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  rows={2} className="input-field resize-none" />
              </div>
            </div>

            <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
              <button onClick={() => setShowNewEvent(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateEvent} disabled={saving} className="flex-1 btn-primary py-2.5 disabled:opacity-50">
                {saving ? 'Saving…' : 'Add Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import React from 'react';
import {
  Bell, BellRing, CheckCircle2, XCircle, CalendarDays, CheckSquare, Users, X,
  Wallet, Palmtree, Ticket, Receipt, FileText, Repeat, AlertTriangle, Megaphone, Clock, UserPlus, KeyRound,
} from 'lucide-react';

export interface NotificationVisual {
  icon: React.ElementType;
  color: string;
  bg: string;
}

const config: Record<string, NotificationVisual> = {
  // Leave
  leave_applied:        { icon: CalendarDays,  color: 'text-blue-600',    bg: 'bg-blue-50' },
  leave_approved:       { icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  leave_rejected:       { icon: XCircle,       color: 'text-red-500',     bg: 'bg-red-50' },
  leave_cancelled:      { icon: X,             color: 'text-slate-500',   bg: 'bg-slate-100' },
  // Salary
  salary_processed:     { icon: Wallet,        color: 'text-emerald-600', bg: 'bg-emerald-50' },
  salary_paid:          { icon: Wallet,        color: 'text-green-600',   bg: 'bg-green-50' },
  // Tasks
  task_assigned:        { icon: CheckSquare,   color: 'text-purple-600',  bg: 'bg-purple-50' },
  task_updated:         { icon: CheckSquare,   color: 'text-amber-600',   bg: 'bg-amber-50' },
  task_completed:       { icon: CheckCircle2,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  collab_invited:       { icon: UserPlus,      color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  recurring_assigned:   { icon: Repeat,        color: 'text-purple-600',  bg: 'bg-purple-50' },
  recurring_overdue:    { icon: AlertTriangle, color: 'text-red-500',     bg: 'bg-red-50' },
  // Company
  holiday_added:        { icon: Palmtree,      color: 'text-teal-600',    bg: 'bg-teal-50' },
  document_added:       { icon: FileText,      color: 'text-sky-600',     bg: 'bg-sky-50' },
  calendar_event:       { icon: CalendarDays,  color: 'text-blue-600',    bg: 'bg-blue-50' },
  // Support / finance
  ticket_created:       { icon: Ticket,        color: 'text-orange-600',  bg: 'bg-orange-50' },
  ticket_updated:       { icon: Ticket,        color: 'text-amber-600',   bg: 'bg-amber-50' },
  expense_submitted:    { icon: Receipt,       color: 'text-blue-600',    bg: 'bg-blue-50' },
  expense_approved:     { icon: Receipt,       color: 'text-emerald-600', bg: 'bg-emerald-50' },
  expense_rejected:     { icon: Receipt,       color: 'text-red-500',     bg: 'bg-red-50' },
  discrepancy_reported: { icon: AlertTriangle, color: 'text-orange-600',  bg: 'bg-orange-50' },
  discrepancy_updated:  { icon: AlertTriangle, color: 'text-amber-600',   bg: 'bg-amber-50' },
  // Misc
  pin_set:              { icon: KeyRound,      color: 'text-amber-600',   bg: 'bg-amber-50' },
  user_approved:        { icon: Users,         color: 'text-indigo-600',  bg: 'bg-indigo-50' },
  approval_reminder:    { icon: BellRing,      color: 'text-amber-600',   bg: 'bg-amber-50' },
  approval_pending:     { icon: BellRing,      color: 'text-orange-600',  bg: 'bg-orange-50' },
  attendance:           { icon: Clock,         color: 'text-blue-600',    bg: 'bg-blue-50' },
  red_flag:             { icon: AlertTriangle, color: 'text-red-500',     bg: 'bg-red-50' },
  broadcast:            { icon: Megaphone,     color: 'text-violet-600',  bg: 'bg-violet-50' },
  general:              { icon: Bell,          color: 'text-slate-500',   bg: 'bg-slate-100' },
};

/** Icon + colours for any notification type (unknown types fall back to "general"). */
export function getNotificationVisual(type: string | null | undefined): NotificationVisual {
  return config[type || 'general'] || config.general;
}

const routeByRelatedType: Record<string, string> = {
  leave_request: '/leave-management',
  task: '/my-tasks',
  recurring_task: '/recurring-tasks',
  payroll: '/payroll',
  holiday: '/holiday-management',
  ticket: '/ticket-centre',
  expense: '/expense-centre',
  document: '/documents',
  discrepancy: '/client-discrepancy-reports',
  calendar_event: '/calendar',
};

/** Which page a notification should open when clicked. */
export function notificationRoute(relatedType?: string | null): string {
  return (relatedType && routeByRelatedType[relatedType]) || '/notifications';
}
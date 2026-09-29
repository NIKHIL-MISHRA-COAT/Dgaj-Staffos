import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function shouldIncludeDate(
  targetDate: Date,
  startDate: Date,
  frequency: string,
  customIntervalDays?: number | null,
  weekdayOnly?: boolean | null
): boolean {
  const dow = targetDate.getDay();

  // Weekday-only filter
  if (weekdayOnly && (dow === 0 || dow === 6)) return false;

  const diffDays = Math.round((targetDate.getTime() - startDate.getTime()) / 86400000);
  if (diffDays < 0) return false;

  switch (frequency) {
    case 'daily':
      return true;
    case 'weekday':
      return dow !== 0 && dow !== 6;
    case 'weekly':
      return diffDays % 7 === 0;
    case 'fortnightly':
      return diffDays % 14 === 0;
    case 'bi-monthly': {
      const dom = targetDate.getDate();
      // Last day of the month
      const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
      // Fire on 15th and 30th; for months with <30 days fire on last day instead of 30th
      return dom === 15 || dom === 30 || (dom === lastDay && lastDay < 30);
    }
    case 'monthly':
      return targetDate.getDate() === startDate.getDate();
    case 'quarterly': {
      const monthDiff =
        (targetDate.getFullYear() - startDate.getFullYear()) * 12 +
        (targetDate.getMonth() - startDate.getMonth());
      return monthDiff % 3 === 0 && targetDate.getDate() === startDate.getDate();
    }
    case 'yearly':
      return (
        targetDate.getMonth() === startDate.getMonth() &&
        targetDate.getDate() === startDate.getDate()
      );
    case 'custom': {
      const interval = customIntervalDays || 1;
      return diffDays % interval === 0;
    }
    default:
      return false;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Parse optional body params
    let daysAhead = 30;
    let forceBackfill = false;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.days_ahead) daysAhead = Number(body.days_ahead);
      if (body?.force_backfill) forceBackfill = Boolean(body.force_backfill);
    } catch {}

    const results: Record<string, unknown> = {};

    // ── STEP 1: Mark overdue recurring_task_instances ─────────────────────────
    const { error: overdueErr } = await supabase
      .from('recurring_task_instances')
      .update({ status: 'overdue', is_overdue: true, updated_at: new Date().toISOString() })
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', todayStr);

    results.overdueMarked = !overdueErr;

    // ── STEP 2: Mark overdue regular tasks ────────────────────────────────────
    await supabase
      .from('tasks')
      .update({ status: 'overdue', is_overdue: true })
      .lt('due_date', todayStr)
      .not('status', 'in', '("done","overdue")')
      .eq('is_active', true);

    // ── STEP 3: Auto check-out for missed clock-outs ──────────────────────────
    const { data: settingRow } = await supabase
      .from('director_settings')
      .select('setting_value')
      .eq('setting_key', 'auto_checkout_time')
      .maybeSingle();

    const autoCheckoutTime: string =
      (settingRow?.setting_value as string)?.replace(/"/g, '') || '17:30';

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: missedCheckouts } = await supabase
      .from('attendance_records')
      .select('id, user_id, clock_in, work_date')
      .eq('work_date', yesterdayStr)
      .not('clock_in', 'is', null)
      .is('clock_out', null)
      .eq('is_auto_checkout', false);

    let autoCheckouts = 0;
    if (missedCheckouts && missedCheckouts.length > 0) {
      for (const record of missedCheckouts) {
        const autoCheckoutDT = new Date(`${record.work_date}T${autoCheckoutTime}:00`);
        const clockInDT = new Date(record.clock_in);
        const totalHours = Math.max(
          0,
          (autoCheckoutDT.getTime() - clockInDT.getTime()) / 3600000
        );
        await supabase
          .from('attendance_records')
          .update({
            clock_out: autoCheckoutDT.toISOString(),
            total_hours: Math.round(totalHours * 100) / 100,
            is_auto_checkout: true,
            auto_checkout_reason: `Auto check-out at configured end-of-day time (${autoCheckoutTime})`,
            notes: `[Auto Check-Out at ${autoCheckoutTime}] System automatically closed attendance.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', record.id);
        autoCheckouts++;
      }
    }
    results.autoCheckouts = autoCheckouts;

    // ── STEP 4: Generate recurring task instances ─────────────────────────────
    // Fetch all active recurring tasks
    const { data: recurringTasks, error: fetchError } = await supabase
      .from('recurring_tasks')
      .select('*')
      .eq('is_active', true);

    if (fetchError) throw fetchError;

    if (!recurringTasks || recurringTasks.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active recurring tasks', spawned: 0, ...results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalSpawned = 0;
    const errors: string[] = [];

    // Generation window:
    // FROM: start_date of each task (backfill all missed instances)
    // TO:   today + daysAhead (future instances)
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + daysAhead);
    const toDateStr = toDate.toISOString().split('T')[0];

    for (const task of recurringTasks) {
      // Skip if end_date has passed
      if (task.end_date && task.end_date < todayStr) continue;

      // BACKFILL: start from task's start_date (not today)
      // This ensures all missed past instances are generated
      const taskStartDate = task.start_date ? new Date(task.start_date) : new Date(todayStr);
      taskStartDate.setHours(0, 0, 0, 0);

      // Clamp to_date to end_date if set
      let effectiveEndDate = new Date(toDate);
      if (task.end_date && new Date(task.end_date) < effectiveEndDate) {
        effectiveEndDate = new Date(task.end_date);
      }
      const effectiveEndStr = effectiveEndDate.toISOString().split('T')[0];

      // Skip if start_date is beyond our generation window
      if (taskStartDate.toISOString().split('T')[0] > effectiveEndStr) continue;

      // Determine target users
      let targetUserIds: string[] = [];
      if (task.assigned_to_users && task.assigned_to_users.length > 0) {
        targetUserIds = task.assigned_to_users;
      } else if (task.assigned_to_role && task.assigned_to_role.length > 0) {
        let usersQuery = supabase
          .from('user_profiles')
          .select('id')
          .in('role', task.assigned_to_role)
          .eq('is_active', true);
        if (task.department && task.department !== 'All') {
          usersQuery = usersQuery.eq('department', task.department);
        }
        const { data: roleUsers } = await usersQuery;
        targetUserIds = (roleUsers || []).map((u: { id: string }) => u.id);
      }

      if (targetUserIds.length === 0) continue;

      // Fetch user profiles for name/dept
      const { data: userProfiles } = await supabase
        .from('user_profiles')
        .select('id, full_name, department')
        .in('id', targetUserIds);

      const profileMap: Record<string, { full_name: string; department: string }> = {};
      (userProfiles || []).forEach((u: { id: string; full_name: string; department: string }) => {
        profileMap[u.id] = { full_name: u.full_name, department: u.department };
      });

      // Pre-fetch existing instances for this task to avoid N+1 dedup queries
      const { data: existingInstances } = await supabase
        .from('recurring_task_instances')
        .select('assigned_to, due_date, sequence_number')
        .eq('recurring_task_id', task.id);

      // Build a Set of "userId|dateStr" for O(1) dedup lookup
      const existingSet = new Set<string>();
      // Build per-user max sequence number map
      const seqMap: Record<string, number> = {};
      (existingInstances || []).forEach((inst: { assigned_to: string; due_date: string; sequence_number: number }) => {
        existingSet.add(`${inst.assigned_to}|${inst.due_date}`);
        const curSeq = seqMap[inst.assigned_to] || 0;
        if (inst.sequence_number > curSeq) {
          seqMap[inst.assigned_to] = inst.sequence_number;
        }
      });

      // Iterate from task start_date to effectiveEndDate (FULL BACKFILL + FUTURE)
      const cur = new Date(taskStartDate);

      while (cur.toISOString().split('T')[0] <= effectiveEndStr) {
        const dateStr = cur.toISOString().split('T')[0];

        if (shouldIncludeDate(cur, taskStartDate, task.frequency, task.custom_interval_days, task.weekday_only)) {
          const dueDateTime = `${dateStr}T${task.due_time || '17:00'}:00`;
          // Past dates are overdue; today and future are pending
          const isOverdue = dateStr < todayStr;
          const instanceStatus = isOverdue ? 'overdue' : 'pending';

          for (const userId of targetUserIds) {
            const dedupKey = `${userId}|${dateStr}`;
            if (existingSet.has(dedupKey)) continue;

            // Increment sequence number
            seqMap[userId] = (seqMap[userId] || 0) + 1;
            const seq = seqMap[userId];

            const profile = profileMap[userId];

            const { error: insertErr } = await supabase
              .from('recurring_task_instances')
              .insert({
                recurring_task_id: task.id,
                assigned_to: userId,
                due_date: dateStr,
                due_datetime: dueDateTime,
                due_time: task.due_time || '17:00',
                status: instanceStatus,
                task_name: task.title,
                sequence_number: seq,
                assigned_datetime: new Date().toISOString(),
                is_overdue: isOverdue,
                priority: task.priority || 'medium',
                frequency: task.frequency,
                client_org_id: task.client_org_id || null,
                client_org_name: task.client_org_name || null,
                organisation_relates_to: task.organisation_relates_to || null,
                notify_before_minutes: task.notify_before_minutes || 30,
                assigned_to_name: profile?.full_name || null,
                assigned_to_dept: profile?.department || null,
              });

            if (insertErr) {
              errors.push(`Task ${task.id} / User ${userId} / Date ${dateStr}: ${insertErr.message}`);
            } else {
              totalSpawned++;
              // Add to set so we don't try to insert again in same run
              existingSet.add(dedupKey);
            }
          }
        }

        cur.setDate(cur.getDate() + 1);
      }
    }

    results.spawned = totalSpawned;
    results.errors = errors;
    results.backfillEnabled = true;

    // ── STEP 5: Notify users about instances due today ────────────────────────
    const { data: dueTodayInstances } = await supabase
      .from('recurring_task_instances')
      .select('id, task_name, assigned_to, recurring_task_id')
      .eq('due_date', todayStr)
      .in('status', ['pending', 'in_progress']);

    const notificationInserts: Array<{
      user_id: string;
      title: string;
      message: string;
      notification_type: string;
      related_id: string;
      related_type: string;
    }> = [];

    (dueTodayInstances || []).forEach((inst: {
      id: string;
      task_name: string;
      assigned_to: string;
      recurring_task_id: string;
    }) => {
      if (inst.assigned_to) {
        notificationInserts.push({
          user_id: inst.assigned_to,
          title: 'Recurring Task Due Today',
          message: `"${inst.task_name}" is due today. Please complete it.`,
          notification_type: 'recurring_task_due_today',
          related_id: inst.id,
          related_type: 'recurring_task_instance',
        });
      }
    });

    // Notify about overdue instances (daily reminder)
    const { data: overdueInstances } = await supabase
      .from('recurring_task_instances')
      .select('id, task_name, assigned_to')
      .eq('status', 'overdue')
      .not('assigned_to', 'is', null);

    (overdueInstances || []).forEach((inst: {
      id: string;
      task_name: string;
      assigned_to: string;
    }) => {
      notificationInserts.push({
        user_id: inst.assigned_to,
        title: 'Overdue Recurring Task',
        message: `"${inst.task_name}" is overdue. Please complete or escalate.`,
        notification_type: 'recurring_task_overdue',
        related_id: inst.id,
        related_type: 'recurring_task_instance',
      });
    });

    if (notificationInserts.length > 0) {
      await supabase.from('app_notifications').insert(notificationInserts).catch(() => {});
    }

    results.notificationsSent = notificationInserts.length;
    results.date = todayStr;
    results.generationWindow = `backfill from start_date → ${toDateStr}`;

    return new Response(JSON.stringify({ message: 'Spawn complete', ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

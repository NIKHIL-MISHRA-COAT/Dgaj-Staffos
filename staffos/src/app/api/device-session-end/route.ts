import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// sendBeacon() cannot set custom headers (like Supabase's apikey header),
// so the client posts here instead and this route talks to Supabase itself.
// Best-effort only — if this never fires (browser killed, no beacon support),
// mark_stale_device_sessions() eventually cleans up the row after 10 minutes
// of no heartbeat, so nothing is left permanently "stuck" active.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_id, device_id } = body || {};
    if (!user_id || !device_id) {
      return NextResponse.json({ error: 'user_id and device_id are required' }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await supabase
      .from('user_device_sessions')
      .update({ is_active: false })
      .eq('user_id', user_id)
      .eq('device_id', device_id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to end device session' }, { status: 500 });
  }
}

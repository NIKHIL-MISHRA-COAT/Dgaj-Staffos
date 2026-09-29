import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service role client — bypasses RLS for director operations
// Falls back gracefully if service role key is not configured
function getAdminClient() {
  if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'your-supabase-service-role-key-here') {
    return null;
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Anon client for verifying director role (uses public SELECT policy)
const supabaseAnon = createClient(
  SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Verify the caller is a director via their userId
async function verifyDirector(userId: string): Promise<boolean> {
  if (!userId) return false;
  const client = getAdminClient() || supabaseAnon;
  const { data, error } = await client
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return !error && data?.role === 'director';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, callerId, updates } = body;

    if (!callerId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const isDirector = await verifyDirector(callerId);
    if (!isDirector) {
      return NextResponse.json({ error: 'Only directors can perform this action' }, { status: 403 });
    }

    const supabaseAdmin = getAdminClient();

    // set_own_pin: director sets their own PIN (userId not required)
    if (action === 'set_own_pin') {
      const { pin } = updates || {};
      if (!pin || !/^\d{4}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
      }

      if (supabaseAdmin) {
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ pin_hash: pin })
          .eq('id', callerId);
        if (error) throw error;
      } else {
        // Fallback: use SECURITY DEFINER RPC function
        const { error } = await supabaseAnon.rpc('set_user_pin', {
          p_user_id: callerId,
          p_pin: pin,
        });
        if (error) throw error;
      }
      return NextResponse.json({ success: true });
    }

    if (!action || !userId) {
      return NextResponse.json({ error: 'Missing action or userId' }, { status: 400 });
    }

    switch (action) {
      case 'set_pin': {
        const { pin } = updates || {};
        if (!pin || !/^\d{4}$/.test(pin)) {
          return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
        }

        if (supabaseAdmin) {
          const { error } = await supabaseAdmin
            .from('user_profiles')
            .update({ pin_hash: pin })
            .eq('id', userId);
          if (error) throw error;
        } else {
          // Fallback: use SECURITY DEFINER RPC function
          const { error } = await supabaseAnon.rpc('set_user_pin', {
            p_user_id: userId,
            p_pin: pin,
          });
          if (error) throw error;
        }
        return NextResponse.json({ success: true });
      }

      case 'approve_user': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ approval_status: 'approved', is_active: true })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'deactivate_user': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ is_active: false })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'reactivate_user': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ is_active: true })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'change_role': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { role } = updates || {};
        if (!role) return NextResponse.json({ error: 'Missing role' }, { status: 400 });
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ role })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'toggle_travel': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { travel_approved } = updates || {};
        const { error } = await supabaseAdmin
          .from('user_profiles')
          .update({ travel_approved })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'approve_request': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { reviewedBy } = updates || {};
        const { error } = await supabaseAdmin
          .from('user_access_requests')
          .update({ status: 'approved', reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'reject_request': {
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Service role key required for this action. Please configure SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 });
        }
        const { reviewedBy } = updates || {};
        const { error } = await supabaseAdmin
          .from('user_access_requests')
          .update({ status: 'rejected', reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Director action error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

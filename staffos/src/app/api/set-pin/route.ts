import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST /api/set-pin
 * Body: { targetUserId, callerId, pin }
 *
 * Sets pin_hash for targetUserId.
 * callerId must be a director (verified via admin client).
 * Uses service role key to bypass RLS entirely.
 * Falls back to SECURITY DEFINER RPC if service role key is missing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { targetUserId, callerId, pin } = body;

    if (!callerId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!pin || !/^\d{4}$/.test(String(pin))) {
      return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 });
    }

    if (!targetUserId) {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
    }

    // Build admin client if service role key is available
    const hasServiceKey = SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'your-supabase-service-role-key-here';
    const adminClient = hasServiceKey
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

    // Anon client for director verification (public SELECT policy allows this)
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller is a director
    const verifyClient = adminClient || anonClient;
    const { data: callerProfile, error: callerError } = await verifyClient
      .from('user_profiles')
      .select('role')
      .eq('id', callerId)
      .single();

    if (callerError || !callerProfile) {
      return NextResponse.json({ error: 'Could not verify caller identity' }, { status: 403 });
    }

    if (callerProfile.role !== 'director') {
      return NextResponse.json({ error: 'Only directors can set PINs' }, { status: 403 });
    }

    // Verify target user exists
    const { data: targetProfile, error: targetError } = await verifyClient
      .from('user_profiles')
      .select('id, email, full_name')
      .eq('id', targetUserId)
      .single();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: 'Target user not found in user_profiles' }, { status: 404 });
    }

    // Set the PIN
    if (adminClient) {
      // Best path: service role bypasses RLS entirely
      const { error: updateError } = await adminClient
        .from('user_profiles')
        .update({ pin_hash: String(pin), updated_at: new Date().toISOString() })
        .eq('id', targetUserId);

      if (updateError) {
        console.error('Admin PIN update error:', updateError);
        return NextResponse.json({ error: `Failed to set PIN: ${updateError.message}` }, { status: 500 });
      }
    } else {
      // Fallback: SECURITY DEFINER RPC function (set_user_pin)
      const { error: rpcError } = await anonClient.rpc('set_user_pin', {
        p_user_id: targetUserId,
        p_pin: String(pin),
      });

      if (rpcError) {
        console.error('RPC set_user_pin error:', rpcError);
        return NextResponse.json({
          error: `Failed to set PIN via RPC: ${rpcError.message}. Please configure SUPABASE_SERVICE_ROLE_KEY in environment variables.`,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: `PIN set successfully for ${targetProfile.full_name || targetProfile.email}`,
    });
  } catch (err: any) {
    console.error('set-pin route error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

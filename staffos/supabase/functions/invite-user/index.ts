import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const userIdHeader = req.headers.get('x-user-id');

    // Create admin client using service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let callerUserId: string | null = null;

    // Method 1: JWT token (standard Supabase auth session)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      // Try to get user from JWT
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user: callerUser }, error: callerError } = await supabaseClient.auth.getUser();
      if (!callerError && callerUser) {
        callerUserId = callerUser.id;
      }
    }

    // Method 2: PIN session — user ID passed directly, verified via service role
    if (!callerUserId && userIdHeader) {
      // Verify the user exists in user_profiles (service role can do this safely)
      const { data: verifyUser, error: verifyError } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('id', userIdHeader)
        .single();
      if (!verifyError && verifyUser) {
        callerUserId = userIdHeader;
      }
    }

    if (!callerUserId) {
      return new Response(JSON.stringify({ error: 'Not authenticated. Please log in again.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the calling user's profile to verify they are director or manager
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', callerUserId)
      .single();

    if (profileError || !callerProfile) {
      return new Response(JSON.stringify({ error: 'Could not verify caller role' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['director', 'manager'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Only Directors and Managers can add users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { email, full_name, role, department, job_title, phone, firm_id } = body;

    if (!email || !full_name || !role || !department || !job_title) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (callerProfile.role === 'manager' && role !== 'employee') {
      return new Response(JSON.stringify({ error: 'Managers can only add employees' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user already exists in user_profiles by email
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return new Response(JSON.stringify({ error: `A user with email ${email} already exists` }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Invite the user via Supabase Admin API — sends an invite email
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name,
        role,
        department,
        job_title,
        phone: phone || '',
        firm_id: firm_id || null,
      },
      redirectTo: `${Deno.env.get('SITE_URL') ?? 'https://staffos8924.builtwithrocket.new'}/auth/callback`,
    });

    if (inviteError) {
      if (inviteError.message?.includes('already been registered')) {
        return new Response(JSON.stringify({ error: `${email} is already registered. They can log in directly.` }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If invite succeeded, update the auto-created profile with the correct role/dept/etc.
    if (inviteData?.user?.id) {
      await supabaseAdmin
        .from('user_profiles')
        .upsert({
          id: inviteData.user.id,
          email,
          full_name,
          role,
          department,
          job_title,
          phone: phone || '',
          firm_id: firm_id || null,
          is_active: true,
          approval_status: 'approved',
        }, { onConflict: 'id' });
    }

    return new Response(
      JSON.stringify({ success: true, message: `Invite sent to ${email}. They will receive an email to set their password.` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

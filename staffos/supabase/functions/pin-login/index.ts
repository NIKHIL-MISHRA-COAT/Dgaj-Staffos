import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Messages for account states the app should explain to the person
const STATE_MESSAGES: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: 'No account found for this email. Contact your Director.' },
  deactivated: { status: 403, message: 'Your account has been deactivated. Contact your Director.' },
  pending: { status: 403, message: 'Your account is pending approval. Contact your Director.' },
  no_pin: { status: 403, message: 'PIN not set. Contact your Director to assign your PIN.' },
  locked: { status: 423, message: 'Too many wrong PIN attempts. Try again in 15 minutes.' },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const pin = String(body?.pin || '');
  if (!email || !/^\d{4}$/.test(pin)) {
    return json({ error: 'Enter your email and 4-digit PIN' }, 400);
  }

  // Service role: the only caller allowed to check PINs or create sessions
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await admin.rpc('verify_login_pin', { p_email: email, p_pin: pin });
  if (error) {
    console.error('verify_login_pin error:', error);
    return json({ error: 'Unable to verify PIN. Please try again.' }, 500);
  }

  const result: any = data || {};
  if (!result.ok) {
    if (result.reason === 'wrong_pin') {
      return json({ error: `Invalid PIN. ${result.attempts_left} attempt(s) left.`, reason: 'wrong_pin' }, 401);
    }
    const state = STATE_MESSAGES[result.reason] || { status: 401, message: 'Invalid PIN. Please try again.' };
    return json({ error: state.message, reason: result.reason }, state.status);
  }

  // Create a one-time login link for this account. No email is sent; the app exchanges
  // the token for a normal Supabase session.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: result.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error('generateLink error:', linkError);
    return json({ error: 'No login account for this email. Contact your Director.' }, 404);
  }

  return json({
    token_hash: tokenHash,
    user_id: result.user_id,
    role: result.role,
    department: result.department,
    full_name: result.full_name,
  });
});
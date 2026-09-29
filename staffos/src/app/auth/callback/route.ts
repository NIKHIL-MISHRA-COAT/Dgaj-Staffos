import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { type NextRequest } from 'next/server';

const roleRoutes: Record<string, string> = {
  employee: '/employee-dashboard',
  manager: '/analytics-reporting-dashboard',
  executive: '/analytics-reporting-dashboard',
  director: '/director-control-panel',
};

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const explicitNext = searchParams.get('next');

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      // If a specific destination was requested (e.g. a deep link), honor it.
      // Otherwise route by the user's actual role, matching the PIN login flow
      // in LoginForm.tsx — don't just dump everyone on /employee-dashboard.
      let destination = explicitNext;
      if (!destination) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', data.user.id)
          .single();
        destination = roleRoutes[profile?.role || 'employee'] || '/employee-dashboard';
      }
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-up-login-screen`);
}

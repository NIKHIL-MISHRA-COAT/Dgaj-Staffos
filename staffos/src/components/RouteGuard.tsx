'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { isRoleAllowed } from '@/lib/routePermissions';

/**
 * Blocks direct-URL access to role-restricted pages for PIN-based sessions.
 *
 * Why this exists alongside middleware.ts: PIN login (LoginForm.tsx's
 * savePinSession) never creates a real Supabase Auth session — it's
 * client-side state only, no signed cookie. middleware.ts runs on the
 * server before any client JS loads, so it has no way to see a PIN
 * session's role at all. This component is what actually stops, say, an
 * employee on a PIN session from typing /director-control-panel into the
 * address bar and landing on it.
 *
 * This is NOT equivalent to real JWT/server-side auth — it's a client-side
 * check that runs after the page's JS loads, so a technically-inclined
 * person could still hit the underlying Supabase REST API directly (the
 * RLS policies on most tables in this app are intentionally open to
 * support PIN sessions — see the fix_firm_rls_pin_auth migration). Treat
 * this as "hide it from normal navigation," not "cryptographically enforced,"
 * for as long as PIN login doesn't issue a real signed session.
 */
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const { effectiveUserId } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);

    if (!effectiveUserId || !pathname) {
      setAllowed(true);
      setChecked(true);
      return;
    }

    supabase.from('user_profiles').select('role').eq('id', effectiveUserId).single().then(({ data }) => {
      if (cancelled) return;
      const ok = isRoleAllowed(pathname, data?.role);
      setAllowed(ok);
      setChecked(true);
      if (!ok) router.replace('/employee-dashboard');
    });

    return () => { cancelled = true; };
  }, [effectiveUserId, pathname]);

  // Avoid a flash of restricted content while the role check is in flight.
  if (!checked || !allowed) return null;
  return <>{children}</>;
}

// Single source of truth for role-based route access, matching the
// client-approved Role-Based Access Matrix. Used by:
//   - Sidebar.tsx (which links to show)
//   - middleware.ts (server-side check for real Supabase Auth sessions)
//   - RouteGuard.tsx (client-side check — covers PIN-based sessions, which
//     middleware cannot see; see the big comment in RouteGuard.tsx for why)

export type Role = 'employee' | 'manager' | 'executive' | 'director';

// Routes not listed here are open to any logged-in role.
export const DIRECTOR_ONLY_ROUTES = [
  '/director-command-hub',
  '/director-control-panel',
  '/firm-configuration',
  '/director-settings',
  '/live-location-map',
  '/firm-reports',
];

export const MANAGER_PLUS_ROUTES = [
  '/analytics-reporting-dashboard',
  '/user-management',
  '/attendance-audit',
  '/leave-admin',
  '/task-analytics',
  '/holiday-management',
];

export function isRoleAllowed(pathname: string, role: string | null | undefined): boolean {
  const r = role || 'employee';
  if (DIRECTOR_ONLY_ROUTES.some((p) => pathname.startsWith(p))) {
    return r === 'director';
  }
  if (MANAGER_PLUS_ROUTES.some((p) => pathname.startsWith(p))) {
    return r === 'director' || r === 'manager' || r === 'executive';
  }
  return true;
}
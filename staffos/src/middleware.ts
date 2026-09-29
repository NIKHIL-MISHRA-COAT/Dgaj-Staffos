import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isRoleAllowed } from '@/lib/routePermissions';

function getProjectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return url.match(/https:\/\/([^.]+)\./)?.[1] ?? '';
}

function injectTokenFromHeader(request: NextRequest): void {
  const token = request.headers.get('x-sb-token');
  if (!token) return;
  const hasCookie = request.cookies.getAll().some((c) => c.name.includes('auth-token'));
  if (hasCookie) return;
  request.cookies.set(`sb-${getProjectRef()}-auth-token`, token);
}

export async function middleware(request: NextRequest) {
  injectTokenFromHeader(request);
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // IMPORTANT — this only protects people who authenticated with a real
  // Supabase Auth session (the email-invite login path, which sets a signed
  // JWT cookie middleware can verify server-side). This app ALSO supports
  // PIN-based login (LoginForm.tsx's savePinSession), which is client-side
  // state only — no cookie, no JWT — so middleware has no way to know who's
  // making the request or what their role is for a PIN session. Those users
  // are protected only by RouteGuard.tsx (client-side) and by whatever the
  // page itself checks. Real server-enforced protection for PIN logins would
  // require PIN login to issue a real signed session — it currently doesn't.
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const pathname = request.nextUrl.pathname;
    if (!isRoleAllowed(pathname, profile?.role)) {
      return NextResponse.redirect(new URL('/employee-dashboard', request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

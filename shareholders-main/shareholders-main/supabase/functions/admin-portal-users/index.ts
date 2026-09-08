import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Origins allowed to call this service-role endpoint. Previously '*'.
 * Kept as an explicit allow-list so a stolen admin JWT cannot be replayed from
 * an attacker-controlled page in the victim's browser.
 */
const ALLOWED_ORIGINS = new Set([
  'https://admin.jtgc.sa',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

/**
 * Authoritative admin test. This used to be an email-suffix heuristic
 * (`!email.endsWith('@internal.local')`), which treated ANY user with an
 * ordinary email address as a portal admin -- including a self-registered one.
 * Public signup is enabled on this project, so that was a live privilege
 * escalation path: register any real address, confirm it, then POST here to mint
 * a genuine `portal_admin: true` account.
 *
 * Admin identity lives in the JWT as app_metadata.portal_admin; there is no
 * admins table. Use the claim, and nothing else.
 */
function isPortalAdmin(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  return user?.app_metadata?.portal_admin === true;
}

/** Roles that sign into the admin panel. Shareholders and subscribers do not. */
type StaffRole = 'admin' | 'editor';

/**
 * An editor is staff but not an admin: they produce content and never receive
 * `portal_admin`, so every `is_portal_admin()` RLS policy keeps them out of
 * shareholder data at the database level, not merely in the UI.
 */
function staffRole(user: { app_metadata?: Record<string, unknown> } | null): StaffRole | null {
  if (isPortalAdmin(user)) return 'admin';
  if (user?.app_metadata?.role === 'editor') return 'editor';
  return null;
}

async function listStaffRows(
  admin: ReturnType<typeof createClient>,
): Promise<Array<{ id: string; email: string; role: StaffRole }>> {
  const rows: Array<{ id: string; email: string; role: StaffRole }> = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = data.users ?? [];
    for (const u of users) {
      const role = staffRole(u);
      if (role) {
        rows.push({ id: u.id, email: u.email ?? '', role });
      }
    }
    if (users.length < 100) hasMore = false;
    else page++;
  }
  return rows;
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const jwt = authHeader.trim().split(' ')[1];
    if (!jwt) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!anonKey || !serviceKey) {
      console.error('admin-portal-users: missing SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');
      return json({ error: 'Server misconfiguration' }, 500);
    }

    // Verify the bearer token server-side. Never trust an unverified decode.
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    const caller = userData?.user ?? null;
    if (userErr || !caller) {
      return json({ error: userErr?.message || 'Invalid or expired session' }, 401);
    }
    if (!isPortalAdmin(caller)) {
      console.warn('admin-portal-users: rejected non-admin caller', caller.id);
      return json({ error: 'Forbidden' }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (req.method === 'GET') {
      const users = await listStaffRows(admin);
      return json({ users });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      // Default to 'admin' so an older client that sends no role keeps its
      // previous behaviour rather than silently creating a weaker account.
      const role: StaffRole = body.role === 'editor' ? 'editor' : 'admin';

      if (!email || !password || password.length < 8) {
        return json({ error: 'Email and password (min 8 characters) are required' }, 400);
      }
      if (body.role !== undefined && body.role !== 'admin' && body.role !== 'editor') {
        return json({ error: "role must be 'admin' or 'editor'" }, 400);
      }
      // Staff accounts must never collide with the portal's synthetic namespace.
      if (email.toLowerCase().endsWith('@internal.local')) {
        return json({ error: 'Invalid email domain for a staff account' }, 400);
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // `portal_admin` stays the authoritative admin flag for RLS; `role` is
        // what the admin panel reads to decide which tabs to show.
        app_metadata: { role, portal_admin: role === 'admin' },
      });
      if (error) {
        return json({ error: error.message }, 400);
      }
      return json({ user: { id: data.user.id, email: data.user.email, role } });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const userId = url.searchParams.get('user_id');
      if (!userId) {
        return json({ error: 'user_id is required' }, 400);
      }
      if (userId === caller.id) {
        return json({ error: 'Cannot delete your own account' }, 400);
      }
      const { data: targetData, error: targetErr } = await admin.auth.admin.getUserById(userId);
      // Gate the target on staff membership, so this endpoint can never be used
      // to delete shareholder or subscriber accounts.
      const targetRole = targetData?.user ? staffRole(targetData.user) : null;
      if (targetErr || !targetData?.user || !targetRole) {
        return json({ error: 'User not found or not a staff account' }, 400);
      }
      // Only admins are load-bearing: deleting the last one would lock everyone
      // out. Editors carry no such constraint.
      if (targetRole === 'admin') {
        const admins = (await listStaffRows(admin)).filter((u) => u.role === 'admin');
        if (admins.length <= 1) {
          return json({ error: 'Cannot delete the last admin account' }, 400);
        }
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) {
        return json({ error: delErr.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('admin-portal-users:', e);
    return json({ error: 'Internal error' }, 500);
  }
});

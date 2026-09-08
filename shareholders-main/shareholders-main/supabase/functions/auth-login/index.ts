import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TEST_OTP_CODE = Deno.env.get('TEST_OTP_CODE') ?? '123456';

// Dedicated app-store reviewer demo account: a single National ID that logs in
// with a fixed code (no SMS/email). Unlocks only the demo stockholder row; real
// accounts are unaffected and still require a real OTP.
const REVIEWER_NATIONAL_ID = Deno.env.get('REVIEWER_NATIONAL_ID') ?? '1000000001';
const REVIEWER_OTP_CODE = Deno.env.get('REVIEWER_OTP_CODE') ?? '123456';

/** Canonical origin string (scheme + host + port) for stable CORS matching. */
function normalizeOrigin(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

const defaultAllowedOrigins = [
  'https://investors.jtgc.sa',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const configuredAllowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

const allowedOrigins =
  configuredAllowedOrigins.length > 0 ? configuredAllowedOrigins : defaultAllowedOrigins.map(normalizeOrigin);

function isOriginAllowed(originHeader: string | null): boolean {
  if (!originHeader) return false;
  return allowedOrigins.includes(normalizeOrigin(originHeader));
}

function getCorsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin');
  const base: HeadersInit = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    Vary: 'Origin',
  };

  if (!origin || !isOriginAllowed(origin)) {
    return base;
  }

  return {
    ...base,
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
  };
}

function ensureAllowedOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin');
  if (origin && isOriginAllowed(origin)) {
    return null;
  }

  return new Response(JSON.stringify({ message: 'Origin not allowed' }), {
    status: 403,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function sanitizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return phone.trim();

  if (digits.startsWith('966') && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith('05') && digits.length === 10) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  if (phone.trim().startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function securePassword(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

async function checkRateLimit(
  admin: ReturnType<typeof createClient>,
  action: string,
  identifier: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const now = Date.now();
  const windowStart = new Date(now - windowSeconds * 1000).toISOString();

  const { count, error } = await admin
    .from('request_rate_limits')
    .select('id', { head: true, count: 'exact' })
    .eq('action', action)
    .eq('identifier', normalizedIdentifier)
    .gte('created_at', windowStart);

  if (error) throw error;

  if ((count ?? 0) >= maxAttempts) {
    const { data: oldest } = await admin
      .from('request_rate_limits')
      .select('created_at')
      .eq('action', action)
      .eq('identifier', normalizedIdentifier)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    const retryAfterSeconds = oldest?.created_at
      ? Math.max(1, Math.ceil((new Date(oldest.created_at).getTime() + windowSeconds * 1000 - now) / 1000))
      : windowSeconds;

    return { allowed: false, retryAfterSeconds };
  }

  const { error: insertError } = await admin
    .from('request_rate_limits')
    .insert({ action, identifier: normalizedIdentifier });

  if (insertError) throw insertError;
  return { allowed: true };
}

async function findAuthUserByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const url = `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`;
  const resp = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const users: Array<{ id: string; email: string }> = data.users ?? [];
  return users.find((user) => user.email === email) ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');
    if (!origin || !isOriginAllowed(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const blockedOrigin = ensureAllowedOrigin(req);
    if (blockedOrigin) return blockedOrigin;

    const { national_id, otp_code } = await req.json();
    if (!national_id || typeof national_id !== 'string' || !otp_code || typeof otp_code !== 'string') {
      return new Response(JSON.stringify({ message: 'National ID and OTP code are required' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const verifyMethod = (Deno.env.get('VERIFY_METHOD') ?? 'sms').trim().toLowerCase();
    const twilioEnv = (Deno.env.get('TWILIO_ENV') ?? 'production').trim().toLowerCase();
    const isTestMode = twilioEnv === 'test';
    const isDebug = (Deno.env.get('OTP_DEBUG') ?? 'false') === 'true';

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const trimmedNationalId = national_id.trim();
    const requestIp = clientIp(req);

    if (!isTestMode) {
      const nationalRateLimit = await checkRateLimit(
        supabaseAdmin,
        'auth-login:national-id',
        trimmedNationalId,
        15,
        60 * 60,
      );
      const ipRateLimit = await checkRateLimit(
        supabaseAdmin,
        'auth-login:ip',
        requestIp,
        40,
        60 * 60,
      );

      if (!nationalRateLimit.allowed || !ipRateLimit.allowed) {
        const retryAfterSeconds = nationalRateLimit.retryAfterSeconds ?? ipRateLimit.retryAfterSeconds ?? 3600;
        return new Response(JSON.stringify({
          message: 'Too many verification attempts. Please try again later.',
          retry_after_seconds: retryAfterSeconds,
        }), {
          status: 429,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
        });
      }
    }

    // A national ID belongs to either a shareholder or a subscriber. Look in the
    // shareholder directory first, then the subscriber one; the rest of the flow
    // is identical apart from the role stamped into the session.
    const { data: stockholder } = await supabaseAdmin
      .from('stockholders')
      .select('id, national_id, phone_number, email, is_active')
      .eq('national_id', trimmedNationalId)
      .maybeSingle();

    let account = stockholder as
      | { id: string; phone_number: string | null; is_active: boolean }
      | null;
    let accountRole: 'shareholder' | 'subscriber' = 'shareholder';

    if (!account) {
      const { data: subscriber } = await supabaseAdmin
        .from('subscribers')
        .select('id, national_id, phone_number, email, is_active')
        .eq('national_id', trimmedNationalId)
        .maybeSingle();

      if (subscriber) {
        account = subscriber;
        accountRole = 'subscriber';
      }
    }

    // Same opaque response whether the ID is unknown or deactivated -- the login
    // screen must not become a directory oracle.
    if (!account || !account.is_active) {
      return new Response(JSON.stringify({ message: 'Invalid or expired verification code.' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // --- OTP Verification ---
    if (isDebug) {
      console.log(`Verifying OTP: Method=${verifyMethod}, ID=${trimmedNationalId}, IP=${requestIp}`);
    }

    if (isTestMode && otp_code.trim() === TEST_OTP_CODE) {
      // Test mode bypass Success
      if (isDebug) console.log('TEST MODE: Verification bypassed with test code');
    } else if (
      trimmedNationalId === REVIEWER_NATIONAL_ID &&
      otp_code.trim() === REVIEWER_OTP_CODE
    ) {
      // App-store reviewer demo account: fixed-code bypass for this one ID only.
      if (isDebug) console.log('REVIEWER demo account: OTP bypass');
    } else if (verifyMethod === 'email') {
      // Email method: check custom database table
      if (isDebug) console.log(`Checking DB for OTP: ID=${trimmedNationalId}, Code=${otp_code.trim()}`);
      
      const { data: dbCode, error: dbError } = await supabaseAdmin
        .from('otp_verification_codes')
        .select('*')
        .eq('national_id', trimmedNationalId)
        .eq('code', otp_code.trim())
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dbError || !dbCode) {
        console.error('Email OTP verification failed:', {
          error: dbError,
          found: !!dbCode,
          method: verifyMethod,
          id: trimmedNationalId,
          code_received: otp_code.trim()
        });
        return new Response(JSON.stringify({ message: 'Invalid or expired verification code.' }), {
          status: 401,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      if (isDebug) console.log(`OTP Verified successfully from DB (ID: ${dbCode.id})`);

      // One-time use: delete the used code
      await supabaseAdmin.from('otp_verification_codes').delete().eq('id', dbCode.id);
    } else {
      if (isDebug) console.log(`Checking Twilio for OTP: Phone=${account.phone_number}`);
      // SMS method: check Twilio
      if (!account.phone_number) {
        return new Response(JSON.stringify({ message: 'No phone number found for this account.' }), {
          status: 401,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      const cleanPhone = sanitizePhone(account.phone_number);
      const twilioAccount = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
      const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
      const twilioVerifySid = Deno.env.get('TWILIO_VERIFY_SERVICE_SID') ?? '';

      if (!twilioAccount || !twilioToken || !twilioVerifySid) {
        console.error('Missing Twilio production secrets');
        return new Response(JSON.stringify({ message: 'Server configuration error. Please contact support.' }), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      const twilioUrl = `https://verify.twilio.com/v2/Services/${twilioVerifySid}/VerificationCheck`;
      const body = new URLSearchParams({ To: cleanPhone, Code: otp_code.trim() });
      const creds = btoa(`${twilioAccount}:${twilioToken}`);

      const twilioResp = await fetch(twilioUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const verifyResult = await twilioResp.json();
      if (!twilioResp.ok || verifyResult.status !== 'approved') {
        console.error('Twilio VerificationCheck failed:', JSON.stringify({ code: verifyResult.code, status: twilioResp.status }));
        return new Response(JSON.stringify({ message: 'Invalid or expired verification code.' }), {
          status: 401,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }
    }

    // --- Authentication (Supabase Auth) ---
    // Separate synthetic-email namespaces, so the two directories can never
    // collide on one auth user even if an ID appeared in both.
    const email =
      accountRole === 'subscriber'
        ? `subscriber_${trimmedNationalId}@internal.local`
        : `stockholder_${trimmedNationalId}@internal.local`;
    const password = securePassword();
    const authPayload = {
      password,
      app_metadata: {
        portal_admin: false,
        // The portal reads this to decide which tabs exist. Only a shareholder
        // carries a stockholder_id; a subscriber has no shareholding to link to.
        role: accountRole,
        stockholder_id: accountRole === 'shareholder' ? account.id : null,
        subscriber_id: accountRole === 'subscriber' ? account.id : null,
        national_id: trimmedNationalId,
      },
      user_metadata: {
        national_id: trimmedNationalId,
      },
    };

    const existingUser = await findAuthUserByEmail(supabaseUrl, supabaseServiceKey, email);
    if (existingUser) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, authPayload);
      if (updateError) {
        console.error('updateUserById failed:', updateError.message);
        return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }
    } else {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        ...authPayload,
      });
      if (createError) {
        console.error('createUser failed:', createError.message);
        return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }
    }

    const authClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: sessionData, error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !sessionData.session) {
      console.error('signInWithPassword failed:', signInError?.message);
      return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      user: { id: sessionData.user!.id, national_id: trimmedNationalId, role: accountRole },
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Login verify unexpected error:', error);
    return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});


import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts';
import { writeAll, readAll } from "https://deno.land/std@0.168.0/streams/conversion.ts";

// Polyfill for deno-smtp compatibility with newer Deno versions where these are no longer in the global Deno object
const denoWithLegacy = Deno as unknown as {
  writeAll?: typeof writeAll;
  readAll?: typeof readAll;
};

if (!denoWithLegacy.writeAll) {
  denoWithLegacy.writeAll = writeAll;
}
if (!denoWithLegacy.readAll) {
  denoWithLegacy.readAll = readAll;
}

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

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '****';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `**@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
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

function mapTwilioError(code: number | undefined, message: string): { userMessage: string; status: number } {
  switch (code) {
    case 60410:
      return { userMessage: 'Verification SMS could not be sent due to security protections. Please contact support.', status: 503 };
    case 60003:
      return { userMessage: 'Too many verification attempts. Please wait a few minutes before trying again.', status: 429 };
    case 60033:
    case 60200:
    case 21211:
    case 21614:
      return { userMessage: 'The phone number on your account is not valid for SMS delivery. Please contact support.', status: 422 };
    default: {
      const lower = (message ?? '').toLowerCase();
      if (lower.includes('blocked') || lower.includes('fraud') || lower.includes('prefix is blocked')) {
        return { userMessage: 'Verification SMS could not be sent due to security protections. Please contact support.', status: 503 };
      }
      if (lower.includes('invalid') || lower.includes('not a valid')) {
        return { userMessage: 'The phone number on your account is not valid for SMS delivery. Please contact support.', status: 422 };
      }
      return { userMessage: 'Failed to send verification code. Please try again later.', status: 500 };
    }
  }
}

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendSmtpEmail(
  to: string,
  code: string,
  config: { host: string; port: number; user: string; pass: string; from: string },
  lang: string = 'ar',
) {
  const translations = {
    en: {
      subject: "Verification Code - Shareholders Portal",
      body: `Verification Code: ${code}\n\nYour code for the Shareholders Portal is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.`
    },
    ar: {
      subject: "رمز التحقق - بوابة المساهمين",
      body: `رمز التحقق الخاص بك (Verification Code): ${code}\n\nرمز التحقق لبوابة المساهمين هو: ${code}\n\nهذا الرمز صالح لمدة 10 دقائق.\n\nإذا لم تكن قد طلبت هذا الرمز، فيرجى تجاهل هذا البريد الإلكتروني.`
    }
  };

  const t = translations[lang.toLowerCase().startsWith('en') ? 'en' : 'ar'];
  const client = new SmtpClient();
  
  try {
    const connectionConfig = {
      hostname: config.host,
      port: config.port,
      username: config.user,
      password: config.pass,
    };

    if (config.port === 465) {
      await client.connectTLS(connectionConfig);
    } else {
      await client.connect(connectionConfig);
    }
    
    await client.send({
      from: config.from,
      to,
      subject: t.subject,
      content: t.body,
    });
    
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
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

    const { national_id, lang = 'ar' } = await req.json();
    const isEn = lang.toLowerCase().startsWith('en');

    if (!national_id || typeof national_id !== 'string') {
      return new Response(JSON.stringify({ message: 'National ID is required' }), {
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
    const limitId = parseInt(Deno.env.get('OTP_LIMIT_ID') ?? '30');
    const limitIp = parseInt(Deno.env.get('OTP_LIMIT_IP') ?? '100');
    const limitWindowMinutes = parseInt(Deno.env.get('OTP_LIMIT_WINDOW_MIN') ?? '60');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const requestIp = clientIp(req);
    const trimmedNationalId = national_id.trim();

    if (!isTestMode) {
      const nationalRateLimit = await checkRateLimit(
        supabaseAdmin,
        'auth-send-otp:national-id',
        trimmedNationalId,
        limitId,
        limitWindowMinutes * 60,
      );
      const ipRateLimit = await checkRateLimit(
        supabaseAdmin,
        'auth-send-otp:ip',
        requestIp,
        limitIp,
        limitWindowMinutes * 60,
      );

      if (!nationalRateLimit.allowed || !ipRateLimit.allowed) {
        const retryAfterSeconds = nationalRateLimit.retryAfterSeconds ?? ipRateLimit.retryAfterSeconds ?? 3600;
        return new Response(JSON.stringify({
          message: 'Too many verification requests. Please try again later.',
          retry_after_seconds: retryAfterSeconds,
        }), {
          status: 429,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
        });
      }
    }

    // A national ID belongs to either a shareholder or a subscriber; both receive
    // an OTP the same way. Shareholders are checked first.
    const { data: stockholderRow } = await supabaseAdmin
      .from('stockholders')
      .select('phone_number, email, is_active')
      .eq('national_id', trimmedNationalId)
      .maybeSingle();

    let account = stockholderRow as
      | { phone_number: string | null; email: string | null; is_active: boolean }
      | null;

    if (!account) {
      const { data: subscriberRow } = await supabaseAdmin
        .from('subscribers')
        .select('phone_number, email, is_active')
        .eq('national_id', trimmedNationalId)
        .maybeSingle();
      account = subscriberRow;
    }

    if (!account || !account.is_active) {
      return new Response(JSON.stringify({ message: 'Unable to send verification code. Please verify your details or contact support.' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    if (verifyMethod === 'email' && !account.email) {
      return new Response(JSON.stringify({ message: 'No email address found for this account. Please use SMS or contact support.' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    if (verifyMethod === 'sms' && !account.phone_number) {
      return new Response(JSON.stringify({ message: 'No phone number found for this account. Please contact support.' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    if (isTestMode) {
      const hint = verifyMethod === 'email' 
        ? maskEmail(account.email || '') 
        : maskPhone(account.phone_number || '');
        
      return new Response(JSON.stringify({
        message: 'Verification code generated successfully.',
        hint: hint,
        verify_method: verifyMethod,
      }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    if (verifyMethod === 'email') {
      const otpCode = generateOtpCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { error: insertError } = await supabaseAdmin
        .from('otp_verification_codes')
        .insert({
          national_id: trimmedNationalId,
          code: otpCode,
          expires_at: expiresAt,
        });

      if (insertError) {
        console.error('Failed to save OTP to database:', insertError);
        throw new Error('Failed to generate verification code');
      }

      const smtpHost = Deno.env.get('SMTP_HOST') || '';
      const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '465');
      const smtpUser = Deno.env.get('SMTP_USER') || '';
      const smtpPass = Deno.env.get('SMTP_PASS') || '';
      const smtpFrom = Deno.env.get('SMTP_FROM') || '';

      if (!smtpHost || !smtpUser || !smtpPass) {
        console.error('Missing SMTP configuration');
        return new Response(JSON.stringify({ message: 'Server configuration error. Please contact support.' }), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      const effectiveFrom = smtpFrom || smtpUser;
      
      try {
        await sendSmtpEmail(account.email!, otpCode, {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          from: effectiveFrom,
        }, lang);
      } catch (smtpError: unknown) {
        console.error('SMTP send error:', smtpError);
        const errorResponse: { message: string; debug?: string } = { 
          message: 'Failed to send verification email. Please try again later.'
        };
        
        if (isDebug) {
          errorResponse.debug = smtpError instanceof Error ? smtpError.message : 'Unknown SMTP error';
        }
        
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        message: isEn 
          ? 'Verification code sent to your registered email address.'
          : 'تم إرسال رمز التحقق إلى بريدك الإلكتروني المسجل.',
        hint: maskEmail(account.email!),
        verify_method: 'email',
      }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    } else {
      // SMS flow via Twilio
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

      const cleanPhone = sanitizePhone(account.phone_number!);
      const twilioUrl = `https://verify.twilio.com/v2/Services/${twilioVerifySid}/Verifications`;
      const body = new URLSearchParams({ To: cleanPhone, Channel: 'sms' });
      const creds = btoa(`${twilioAccount}:${twilioToken}`);

      const twilioResp = await fetch(twilioUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!twilioResp.ok) {
        const err = await twilioResp.json();
        console.error('Twilio send OTP error:', JSON.stringify({ code: err.code, message: err.message, status: twilioResp.status }));
        const { userMessage, status } = mapTwilioError(err.code, err.message ?? '');
        return new Response(JSON.stringify({ message: userMessage }), {
          status,
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        message: isEn 
          ? 'Verification code sent successfully.'
          : 'تم إرسال رمز التحقق بنجاح.',
        hint: maskPhone(cleanPhone),
        verify_method: 'sms',
      }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Send OTP unexpected error:', error);
    return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});


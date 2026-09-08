import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SmtpClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts';
import { writeAll, readAll } from 'https://deno.land/std@0.168.0/streams/conversion.ts';

// Polyfill for deno-smtp compatibility with newer Deno versions where these are
// no longer exposed on the global Deno object.
const denoWithLegacy = Deno as unknown as {
  writeAll?: typeof writeAll;
  readAll?: typeof readAll;
};
if (!denoWithLegacy.writeAll) denoWithLegacy.writeAll = writeAll;
if (!denoWithLegacy.readAll) denoWithLegacy.readAll = readAll;

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

// Includes the admin panel dev origin (port 3001) which is NOT in the OTP
// function's defaults. Set ALLOWED_ORIGINS (comma-separated) to add the admin
// panel's production origin; configured values are MERGED with these defaults
// so local development always works.
const defaultAllowedOrigins = [
  'https://investors.jtgc.sa',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

const configuredAllowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

const allowedOrigins = Array.from(
  new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins].map(normalizeOrigin)),
);

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

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '****';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `**@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

const NOTIFICATION_SUBJECT = 'New Announcement · إعلان جديد — JTGC';

function buildNotificationBody(portalUrl: string): string {
  return [
    'Dear Shareholder,',
    '',
    'A new announcement has been posted on the Jeddah Tourist Guides Cooperative shareholders portal.',
    'Please log in to view it:',
    portalUrl,
    '',
    '— — —',
    '',
    'عزيزي المساهم،',
    '',
    'تم نشر إعلان جديد في بوابة المساهمين لجمعية المرشدين السياحيين التعاونية بجدة.',
    'يرجى تسجيل الدخول لعرضه:',
    portalUrl,
  ].join('\n');
}

/**
 * Sends an individual notification email to each recipient (never exposing the
 * recipient list). Processes in batches with a fresh connection per batch so a
 * dropped connection cannot abort the whole run; per-recipient failures are
 * counted but do not stop the batch.
 */
async function sendNotificationEmails(
  recipients: string[],
  config: SmtpConfig,
  portalUrl: string,
): Promise<number> {
  const content = buildNotificationBody(portalUrl);
  const batchSize = 15;
  let sent = 0;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
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

      for (const to of batch) {
        try {
          await client.send({
            from: config.from,
            to,
            subject: NOTIFICATION_SUBJECT,
            content,
          });
          sent++;
        } catch (sendError) {
          console.error('Failed to send announcement email to', maskEmail(to), sendError);
        }
      }
    } catch (batchError) {
      console.error('SMTP batch connection error:', batchError);
    } finally {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
    }

    // Brief pause between batches to avoid SMTP throttling.
    if (i + batchSize < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return sent;
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- Authorization: caller must be an authenticated portal admin ---
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return new Response(JSON.stringify({ message: 'Authentication required.' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    const isPortalAdmin = userData?.user?.app_metadata?.portal_admin === true;
    if (userError || !userData?.user || !isPortalAdmin) {
      return new Response(JSON.stringify({ message: 'Forbidden: portal admin access required.' }), {
        status: 403,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // --- Validate input ---
    const { announcement_id } = await req.json();
    if (!announcement_id || typeof announcement_id !== 'string') {
      return new Response(JSON.stringify({ message: 'announcement_id is required.' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // --- Load announcement and ensure it is published ---
    const { data: announcement, error: annError } = await supabaseAdmin
      .from('announcements')
      .select('id, is_published')
      .eq('id', announcement_id)
      .single();

    if (annError || !announcement) {
      return new Response(JSON.stringify({ message: 'Announcement not found.' }), {
        status: 404,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    if (!announcement.is_published) {
      return new Response(JSON.stringify({ message: 'Announcement must be published before notifying shareholders.' }), {
        status: 400,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // --- Collect recipients (active stockholders AND subscribers with an email) ---
    // Announcements go to everyone the cooperative publishes to, which since the
    // subscriber role exists is both directories. The Set below also collapses
    // anyone who happens to appear in both.
    const [stockholdersResult, subscribersResult] = await Promise.all([
      supabaseAdmin
        .from('stockholders')
        .select('email')
        .eq('is_active', true)
        .not('email', 'is', null),
      supabaseAdmin
        .from('subscribers')
        .select('email')
        .eq('is_active', true)
        .not('email', 'is', null),
    ]);

    if (stockholdersResult.error) {
      console.error('Failed to load stockholder recipients:', stockholdersResult.error);
      throw new Error('Failed to load recipients.');
    }
    if (subscribersResult.error) {
      console.error('Failed to load subscriber recipients:', subscribersResult.error);
      throw new Error('Failed to load recipients.');
    }

    const recipients = Array.from(
      new Set(
        [...(stockholdersResult.data ?? []), ...(subscribersResult.data ?? [])]
          .map((row) => (row.email ?? '').trim().toLowerCase())
          .filter(isValidEmail),
      ),
    );

    // --- SMTP configuration (shared project secrets) ---
    const smtpHost = Deno.env.get('SMTP_HOST') || '';
    const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '465');
    const smtpUser = Deno.env.get('SMTP_USER') || '';
    const smtpPass = Deno.env.get('SMTP_PASS') || '';
    const smtpFrom = Deno.env.get('SMTP_FROM') || smtpUser;
    const portalUrl = Deno.env.get('PORTAL_URL') || 'https://investors.jtgc.sa';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error('Missing SMTP configuration');
      return new Response(JSON.stringify({ message: 'Server email configuration error. Please contact support.' }), {
        status: 500,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    if (recipients.length > 0) {
      sent = await sendNotificationEmails(
        recipients,
        { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: smtpFrom },
        portalUrl,
      );
    }

    // --- Record the send on the announcement ---
    const notificationSentAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('announcements')
      .update({
        notification_sent_at: notificationSentAt,
        notification_recipient_count: sent,
      })
      .eq('id', announcement_id);

    if (updateError) {
      console.error('Failed to record notification send:', updateError);
    }

    return new Response(
      JSON.stringify({
        sent,
        recipient_count: sent,
        total_recipients: recipients.length,
        notification_sent_at: notificationSentAt,
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('send-announcement-notifications error:', error);
    return new Response(JSON.stringify({ message: 'An unexpected error occurred. Please try again later.' }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

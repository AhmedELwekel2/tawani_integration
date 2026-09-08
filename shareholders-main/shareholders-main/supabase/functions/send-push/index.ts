import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '';

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sigBuf))}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error('OAuth token error: ' + JSON.stringify(json));
  cachedToken = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cachedToken.token;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Only the DB trigger may invoke this. The trigger sends a random dispatch token stored in Vault
  // (secret `edge_service_role_key`); we validate it here via the service-role client. The project
  // service_role key itself is never transmitted by the caller (least privilege).
  const auth = req.headers.get('Authorization') ?? '';
  const { data: expected } = await admin.rpc('get_push_dispatch_token');
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  // FCM service account: prefer the FCM_SERVICE_ACCOUNT env secret; fall back to the copy stored in
  // Vault (read via the service-role client), so the function works with secrets fully managed in Vault.
  let fcmRaw = FCM_SERVICE_ACCOUNT;
  if (!fcmRaw) {
    const { data: fcmFromVault } = await admin.rpc('get_fcm_service_account');
    fcmRaw = fcmFromVault ?? '';
  }
  if (!fcmRaw) {
    return new Response(JSON.stringify({ error: 'FCM_SERVICE_ACCOUNT not configured' }), { status: 500 });
  }

  let sa: any;
  try { sa = JSON.parse(fcmRaw); } catch { return new Response('Invalid FCM_SERVICE_ACCOUNT', { status: 500 }); }
  const projectId = sa.project_id;

  const payload = await req.json().catch(() => ({}));
  const table = payload.table;
  const record = payload.record ?? {};

  async function tokensForStockholder(id: string): Promise<string[]> {
    const { data: rows } = await admin.from('device_tokens').select('token').eq('stockholder_id', id);
    return (rows ?? []).map((r: any) => r.token);
  }

  let title = '';
  let body = '';
  const data: Record<string, string> = {};
  let tokens: string[] = [];

  if (table === 'announcements') {
    if (!record.published_at) return new Response(JSON.stringify({ skipped: 'draft' }), { status: 200 });
    title = record.title_en || record.title_ar || 'New announcement';
    body = 'New announcement · إعلان جديد';
    data.type = 'announcement';
    data.id = String(record.id ?? '');
    const { data: rows } = await admin.from('device_tokens').select('token');
    tokens = (rows ?? []).map((r: any) => r.token);
  } else if (table === 'stockholder_transactions') {
    if (record.transaction_type !== 'purchase') return new Response(JSON.stringify({ skipped: 'not a purchase' }), { status: 200 });
    title = 'Shares received · استلام أسهم';
    body = `${record.shares} shares · ${record.shares} سهم`;
    data.type = 'transaction';
    data.id = String(record.id ?? '');
    tokens = await tokensForStockholder(record.stockholder_id);
  } else if (table === 'yearly_dividends') {
    title = 'Dividend posted · أرباح سنوية';
    body = `Year ${record.year} · سنة ${record.year}`;
    data.type = 'dividend';
    data.id = String(record.id ?? '');
    tokens = await tokensForStockholder(record.stockholder_id);
  } else {
    return new Response(JSON.stringify({ skipped: 'unhandled table', table }), { status: 200 });
  }

  if (tokens.length === 0) return new Response(JSON.stringify({ sent: 0, total: 0 }), { status: 200 });

  const accessToken = await getAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  let sent = 0;
  let removed = 0;
  await Promise.all(tokens.map(async (token) => {
    const message = {
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'HIGH' },
        apns: { headers: { 'apns-priority': '10' } },
      },
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (resp.ok) { sent++; return; }
    const err = await resp.json().catch(() => ({}));
    const status = err?.error?.status;
    if (resp.status === 404 || status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT') {
      await admin.from('device_tokens').delete().eq('token', token);
      removed++;
    }
  }));

  return new Response(JSON.stringify({ sent, removed, total: tokens.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

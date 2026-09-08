// send-admin-notification
//
// Emails every portal admin, in Arabic, whenever a shareholder submits the
// Contact Us form or the Feedback survey.
//
// Invoked ONLY by DB triggers via pg_net:
//   - contact_submissions  AFTER INSERT ... FOR EACH ROW
//   - feedback_answers     AFTER INSERT ... FOR EACH STATEMENT
// Server-to-server, so there is no CORS block and no user JWT; authorization is
// the Vault dispatch token, exactly as in send-push.
//
// The trigger sends only { event, record_id }. It deliberately does NOT send the
// row: net.http_request_queue holds the request body until the worker drains it
// and is SELECT-able by anon/authenticated, so shipping a contact message
// through it would be a needless PII exposure. A UUID is not PII. We re-read the
// row here with service_role instead.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { connect as smtpConnect } from './smtp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') ?? '465', 10);
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;

const ADMIN_PORTAL_URL = (
  Deno.env.get('ADMIN_PORTAL_URL') || 'https://moccasin-louse-717217.hostingersite.com'
).replace(/\/$/, '');

// The DB dispatcher gives pg_net a 30s timeout. Stay under it so a stalled
// mail server produces a real response with counts rather than a pg_net
// timeout with no diagnostics at all.
const SEND_BUDGET_MS = 25000;

// ─── Small helpers ────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

/**
 * MUST be applied to every user-supplied string. `subject`, `message` and the
 * free-text survey answers arrive from a public, unauthenticated endpoint and
 * the reader of this email is an administrator.
 */
function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/**
 * Gregorian calendar + Latin digits, Riyadh time. Plain 'ar-SA' yields Hijri
 * dates and Arabic-Indic numerals, which would not match what the admin panel
 * shows and makes cross-referencing a submission painful.
 */
function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Latin/numeric runs must be isolated or the bidi algorithm reorders them. */
function ltr(value: unknown): string {
  return `<span dir="ltr" style="unicode-bidi:isolate;">${escapeHtml(value)}</span>`;
}

// Exact labels from stackholders-admin-panel/src/components/FeedbackView.tsx
const RATING_LABELS: Record<number, string> = {
  1: 'غير راضٍ',
  2: 'غير راضٍ نسبياً',
  3: 'محايد',
  4: 'راضٍ',
  5: 'راضٍ جداً',
};

function stars(value: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

// ─── HTML shell ───────────────────────────────────────────────────────────────

const FONT_STACK = "'Segoe UI', Tahoma, 'Traditional Arabic', Arial, sans-serif";

function shell(title: string, bodyHtml: string, ctaHref: string, footerNote: string): string {
  // Styles are inline throughout: Gmail strips <style> blocks.
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;font-family:${FONT_STACK};direction:rtl;text-align:right;">
  <tr><td style="background:#7c3aed;padding:18px 24px;color:#ffffff;font-size:17px;font-weight:700;">
    ${escapeHtml(title)}
  </td></tr>
  <tr><td style="padding:22px 24px;color:#1e293b;font-size:14px;line-height:1.7;">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:0 24px 24px;">
    <a href="${escapeHtml(ctaHref)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:700;">
      فتح لوحة التحكم
    </a>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;color:#64748b;font-size:12px;line-height:1.6;">
    ${escapeHtml(footerNote)}<br>
    رسالة آلية من نظام جمعية المرشدين السياحيين التعاونية بجدة.
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** One label/value row. `valueHtml` is inserted raw — callers must pre-escape. */
function field(label: string, valueHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
  <tr>
    <td width="130" valign="top" style="color:#64748b;font-size:13px;padding:6px 0 6px 10px;white-space:nowrap;">${escapeHtml(label)}</td>
    <td valign="top" style="color:#1e293b;font-size:14px;padding:6px 0;font-weight:600;">${valueHtml}</td>
  </tr>
</table>`;
}

function block(label: string, valueHtml: string): string {
  return `<div style="margin-top:16px;">
  <div style="color:#64748b;font-size:13px;margin-bottom:6px;">${escapeHtml(label)}</div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;color:#1e293b;font-size:14px;line-height:1.8;">${valueHtml}</div>
</div>`;
}

// ─── Contact email ────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  subject: string | null;
  message: string | null;
  status: string | null;
  created_at: string;
}

function buildContactEmail(row: ContactRow): { subject: string; html: string; text: string } {
  const subjectLine = (row.subject ?? '').trim();
  const capped = subjectLine.length > 80 ? `${subjectLine.slice(0, 80)}…` : subjectLine;

  const html = shell(
    'رسالة تواصل جديدة',
    [
      field('الاسم', escapeHtml(row.name || '—')),
      field('البريد الإلكتروني', row.email ? ltr(row.email) : '—'),
      field('رقم الجوال', row.phone_number ? ltr(row.phone_number) : '—'),
      field('الموضوع', escapeHtml(row.subject || '—')),
      field('تاريخ الإرسال', escapeHtml(formatDateAr(row.created_at))),
      block('نص الرسالة', nl2br(row.message || '—')),
    ].join('\n'),
    `${ADMIN_PORTAL_URL}/?view=contact`,
    'يمكنك الرد مباشرةً على هذه الرسالة للتواصل مع المرسل.',
  );

  const text = [
    'رسالة تواصل جديدة',
    '',
    `الاسم: ${row.name || '—'}`,
    `البريد الإلكتروني: ${row.email || '—'}`,
    `رقم الجوال: ${row.phone_number || '—'}`,
    `الموضوع: ${row.subject || '—'}`,
    `تاريخ الإرسال: ${formatDateAr(row.created_at)}`,
    '',
    'نص الرسالة:',
    row.message || '—',
    '',
    `لوحة التحكم: ${ADMIN_PORTAL_URL}/?view=contact`,
  ].join('\n');

  return { subject: capped ? `رسالة تواصل جديدة: ${capped}` : 'رسالة تواصل جديدة', html, text };
}

// ─── Feedback email ───────────────────────────────────────────────────────────

interface FeedbackRow {
  id: string;
  stockholder_id: string | null;
  overall_rating: number | string | null;
  submitted_at: string;
  stockholder_name_ar: string | null;
  stockholder_name_en: string | null;
  stockholder_national_id: string | null;
  stockholder_email: string | null;
}
interface AnswerRow {
  question_id: string;
  rating_value: number | null;
  text_value: string | null;
}
interface QuestionRow {
  id: string;
  question_ar: string | null;
  question_type: string | null;
  category_ar: string | null;
  sort_order: number | null;
}

function buildFeedbackEmail(
  resp: FeedbackRow,
  answers: AnswerRow[],
  questions: QuestionRow[],
): { subject: string; html: string; text: string } {
  const overall = resp.overall_rating === null ? null : Number(resp.overall_rating);
  const respondent = resp.stockholder_name_ar || resp.stockholder_name_en || null;

  const qById = new Map<string, QuestionRow>();
  for (const q of questions) qById.set(q.id, q);

  // Only render questions this response actually carries an answer row for.
  // Flutter skips unanswered questions entirely; the web portal posts rows with
  // BOTH values null. Both cases must render without throwing.
  const answered = answers
    .map((a) => ({ a, q: qById.get(a.question_id) }))
    .filter((x): x is { a: AnswerRow; q: QuestionRow } => Boolean(x.q))
    .sort((x, y) => (x.q.sort_order ?? 0) - (y.q.sort_order ?? 0));

  const groups: { cat: string; items: { a: AnswerRow; q: QuestionRow }[] }[] = [];
  for (const item of answered) {
    const cat = item.q.category_ar || 'عام';
    const existing = groups.find((g) => g.cat === cat);
    if (existing) existing.items.push(item);
    else groups.push({ cat, items: [item] });
  }

  const answersHtml = groups
    .map(
      (g) => `<div style="margin-top:18px;">
  <div style="background:#ede9fe;color:#5b21b6;font-size:13px;font-weight:700;border-radius:6px;padding:7px 12px;">${escapeHtml(g.cat)}</div>
  ${g.items
    .map((item) => {
      const answerHtml =
        item.a.rating_value !== null && item.a.rating_value !== undefined
          ? `<span style="color:#f59e0b;font-size:15px;">${stars(item.a.rating_value)}</span>
             ${ltr(`${item.a.rating_value} / 5`)}
             <span style="color:#475569;"> — ${escapeHtml(RATING_LABELS[item.a.rating_value] ?? '')}</span>`
          : item.a.text_value && item.a.text_value.trim()
            ? `<span style="color:#1e293b;">${nl2br(item.a.text_value)}</span>`
            : `<span style="color:#94a3b8;font-style:italic;">لم تتم الإجابة</span>`;
      return `<div style="border-bottom:1px solid #f1f5f9;padding:10px 2px;">
        <div style="color:#334155;font-size:13px;margin-bottom:4px;">${escapeHtml(item.q.question_ar || '')}</div>
        <div style="font-size:14px;font-weight:600;">${answerHtml}</div>
      </div>`;
    })
    .join('\n')}
</div>`,
    )
    .join('\n');

  const identityHtml = [
    field('المساهم', respondent ? escapeHtml(respondent) : '<span style="color:#94a3b8;">غير معروف</span>'),
    field('رقم الهوية', resp.stockholder_national_id ? ltr(resp.stockholder_national_id) : '—'),
    field('البريد الإلكتروني', resp.stockholder_email ? ltr(resp.stockholder_email) : '—'),
    field(
      'متوسط التقييم',
      overall === null
        ? '—'
        : `<span style="color:#f59e0b;font-size:15px;">${stars(overall)}</span> ${ltr(`${overall.toFixed(2)} / 5`)}`,
    ),
    field('تاريخ الإرسال', escapeHtml(formatDateAr(resp.submitted_at))),
  ].join('\n');

  const html = shell(
    'تقييم جديد من أحد المساهمين',
    identityHtml + answersHtml,
    `${ADMIN_PORTAL_URL}/?view=feedback`,
    'الرجاء عدم الرد على هذا البريد.',
  );

  const text = [
    'تقييم جديد من أحد المساهمين',
    '',
    `المساهم: ${respondent || 'غير معروف'}`,
    `رقم الهوية: ${resp.stockholder_national_id || '—'}`,
    `البريد الإلكتروني: ${resp.stockholder_email || '—'}`,
    `متوسط التقييم: ${overall === null ? '—' : `${overall.toFixed(2)} / 5`}`,
    `تاريخ الإرسال: ${formatDateAr(resp.submitted_at)}`,
    '',
    ...groups.flatMap((g) => [
      `— ${g.cat} —`,
      ...g.items.map((item) => {
        const ans =
          item.a.rating_value !== null && item.a.rating_value !== undefined
            ? `${item.a.rating_value} / 5 — ${RATING_LABELS[item.a.rating_value] ?? ''}`
            : item.a.text_value && item.a.text_value.trim()
              ? item.a.text_value
              : 'لم تتم الإجابة';
        return `${item.q.question_ar || ''}\n   ${ans}`;
      }),
      '',
    ]),
    `لوحة التحكم: ${ADMIN_PORTAL_URL}/?view=feedback`,
  ].join('\n');

  const subject =
    overall === null
      ? 'تقييم جديد من أحد المساهمين'
      : `تقييم جديد من أحد المساهمين (${overall.toFixed(1)}/5)`;

  return { subject, html, text };
}

// ─── SMTP fan-out ─────────────────────────────────────────────────────────────

interface Mail {
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * One message per admin — never a shared To:/Cc:. A single authenticated
 * connection serves the whole (small) admin list, with RSET between recipients
 * so one bad address cannot poison the next. Per-recipient failures are logged
 * with the address masked and never abort the run.
 */
async function sendToAdmins(recipients: string[], mail: Mail): Promise<number> {
  let sent = 0;

  const session = await smtpConnect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: SMTP_FROM,
  });

  try {
    for (const to of recipients) {
      try {
        await session.send({
          to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          replyTo: mail.replyTo,
          headers: {
            'Content-Language': 'ar',
            'Auto-Submitted': 'auto-generated',
            'X-Auto-Response-Suppress': 'All',
          },
        });
        sent++;
      } catch (sendError) {
        console.error('admin notification send failed for', maskEmail(to), sendError);
        try {
          await session.reset();
        } catch {
          // Connection is unusable; remaining recipients will fail fast.
        }
      }
    }
    await session.quit();
  } finally {
    session.close();
  }

  return sent;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!SERVICE_ROLE_KEY) return json({ ok: false, message: 'Server not configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Only the DB triggers may invoke this. Same Vault dispatch token as
  // send-push: one secret, one rotation surface, same trust domain.
  const auth = req.headers.get('Authorization') ?? '';
  const { data: expected } = await admin.rpc('get_push_dispatch_token');
  if (!expected || auth !== `Bearer ${expected}`) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const event = payload?.event;
    const recordId = payload?.record_id;

    if (typeof recordId !== 'string' || !recordId) {
      return json({ ok: false, message: 'record_id is required' }, 400);
    }

    let mail: Mail;

    if (event === 'contact_submission') {
      const { data: row, error } = await admin
        .from('contact_submissions')
        .select('id, name, email, phone_number, subject, message, status, created_at')
        .eq('id', recordId)
        .single();
      if (error || !row) {
        console.error('contact_submission not found:', recordId, error);
        return json({ ok: false, message: 'Record not found' }, 404);
      }

      const built = buildContactEmail(row as ContactRow);
      const submitterEmail = (row as ContactRow).email?.trim().toLowerCase() ?? '';
      mail = {
        ...built,
        // Admins can hit Reply and reach the submitter directly.
        replyTo: isValidEmail(submitterEmail) ? submitterEmail : undefined,
      };
    } else if (event === 'feedback_response') {
      const [respRes, answersRes, questionsRes] = await Promise.all([
        admin
          .from('feedback_responses')
          .select(
            'id, stockholder_id, overall_rating, submitted_at, stockholder_name_ar, stockholder_name_en, stockholder_national_id, stockholder_email',
          )
          .eq('id', recordId)
          .single(),
        admin.from('feedback_answers').select('question_id, rating_value, text_value').eq('response_id', recordId),
        // Deliberately NOT filtered by is_active: a question deactivated after
        // being answered must still render its Arabic text.
        admin.from('feedback_questions').select('id, question_ar, question_type, category_ar, sort_order'),
      ]);

      if (respRes.error || !respRes.data) {
        console.error('feedback_response not found:', recordId, respRes.error);
        return json({ ok: false, message: 'Record not found' }, 404);
      }

      const resp = respRes.data as FeedbackRow;
      const built = buildFeedbackEmail(
        resp,
        (answersRes.data ?? []) as AnswerRow[],
        (questionsRes.data ?? []) as QuestionRow[],
      );

      // Only reply-to an identified respondent. An anonymous response has no
      // snapshot email, and a Reply-To pointing at SMTP_FROM would look like it
      // reached the respondent when it did not.
      const respondentEmail = resp.stockholder_email?.trim().toLowerCase() ?? '';
      mail = {
        ...built,
        replyTo: resp.stockholder_id && isValidEmail(respondentEmail) ? respondentEmail : undefined,
      };
    } else {
      // 200 so pg_net does not record a spurious failure.
      return json({ ok: true, skipped: 'unhandled event', event }, 200);
    }

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.error('Missing SMTP configuration');
      return json({ ok: false, message: 'Server email configuration error' }, 500);
    }

    const { data: adminRows, error: adminError } = await admin.rpc('get_portal_admin_emails');
    if (adminError) {
      console.error('Failed to load portal admins:', adminError);
      return json({ ok: false, message: 'Failed to load recipients' }, 500);
    }

    // Defence in depth: even though the RPC already filters, re-validate here so
    // a future mis-GRANT or a mis-flagged account cannot leak on its own.
    const recipients = Array.from(
      new Set(
        ((adminRows ?? []) as { email: string | null }[])
          .map((r) => (r.email ?? '').trim().toLowerCase())
          .filter((e) => isValidEmail(e) && !e.endsWith('@internal.local')),
      ),
    );

    if (recipients.length === 0) {
      console.error('No portal admin recipients found');
      return json({ ok: true, event, record_id: recordId, sent: 0, failed: 0, total_recipients: 0 }, 200);
    }

    let sent = 0;
    try {
      sent = await Promise.race([
        sendToAdmins(recipients, mail),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('SMTP send budget exhausted')), SEND_BUDGET_MS),
        ),
      ]);
    } catch (sendError) {
      // The submission is already stored; report the failure rather than
      // hanging until pg_net gives up with no diagnostics.
      console.error('admin notification fan-out failed:', sendError);
      return json(
        { ok: false, event, record_id: recordId, sent: 0, failed: recipients.length, total_recipients: recipients.length },
        500,
      );
    }

    // Counts only. This body is persisted in net._http_response for ~6h and that
    // table is readable by anon/authenticated — never put an address or message
    // text in here.
    return json({
      ok: true,
      event,
      record_id: recordId,
      sent,
      failed: recipients.length - sent,
      total_recipients: recipients.length,
    });
  } catch (error) {
    console.error('send-admin-notification error:', error);
    return json({ ok: false, message: 'An unexpected error occurred' }, 500);
  }
});

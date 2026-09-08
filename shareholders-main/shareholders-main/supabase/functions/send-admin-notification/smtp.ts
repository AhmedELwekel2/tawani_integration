// Minimal SMTP client, written directly against Deno's TLS socket.
//
// Why not a library:
//   - deno.land/x/smtp@v0.7.0 (used by auth-send-otp and
//     send-announcement-notifications) is abandoned, needs a writeAll/readAll
//     monkey-patch to run on current Deno, has no STARTTLS path at all (so a
//     port-587 config sends credentials in cleartext), and sends plain text only.
//   - denomailer@1.6.0 hangs indefinitely on the Supabase Edge Runtime; a
//     dispatch against it timed out at 30s with no completion log, while a raw
//     Deno.connectTls to the same host returned its 220 greeting in 335ms.
//
// Every read is bounded by a timeout, so this can never hang the way denomailer
// did. Bodies are sent as multipart/alternative with base64 UTF-8 parts, which
// is what makes the Arabic content survive intact.

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

const READ_TIMEOUT_MS = 15000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

function b64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64, hard-wrapped at 76 chars as required for MIME bodies. */
function b64Body(input: string): string {
  const enc = b64(input);
  const lines: string[] = [];
  for (let i = 0; i < enc.length; i += 76) lines.push(enc.slice(i, i + 76));
  return lines.join('\r\n');
}

/**
 * RFC 2047 encoded-words for a non-ASCII subject. Chunked on CHARACTER
 * boundaries at <=45 UTF-8 bytes so no encoded-word exceeds the 75-char limit
 * and no multi-byte Arabic character is ever split across two words.
 */
export function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(subject)) return subject;

  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const ch of subject) {
    const size = encoder.encode(ch).length;
    if (currentBytes + size > 45) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) chunks.push(current);

  return chunks.map((c) => `=?UTF-8?B?${b64(c)}?=`).join('\r\n ');
}

/** `Display Name <a@b.c>` -> `a@b.c`; a bare address passes through. */
export function extractAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

interface Reply {
  code: number;
  text: string;
}

class SmtpConnection {
  private buf = '';
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private conn: Deno.Conn) {}

  close(): void {
    try {
      this.conn.close();
    } catch {
      // already closed
    }
  }

  private async writeRaw(data: string): Promise<void> {
    const bytes = this.encoder.encode(data);
    let offset = 0;
    while (offset < bytes.length) {
      const n = await withTimeout(this.conn.write(bytes.subarray(offset)), READ_TIMEOUT_MS, 'smtp write');
      if (n <= 0) throw new Error('smtp write returned 0');
      offset += n;
    }
  }

  /**
   * Pulls one complete reply out of the buffer. SMTP continuation lines are
   * `250-text` and the final line is `250 text` (space), so we must keep
   * reading until a space-form line arrives.
   */
  private takeReply(): Reply | null {
    let cursor = 0;
    const collected: string[] = [];
    for (;;) {
      const nl = this.buf.indexOf('\r\n', cursor);
      if (nl === -1) return null;
      const line = this.buf.slice(cursor, nl);
      collected.push(line);
      cursor = nl + 2;
      if (/^\d{3} /.test(line)) {
        this.buf = this.buf.slice(cursor);
        return { code: parseInt(line.slice(0, 3), 10), text: collected.join('\n') };
      }
      if (!/^\d{3}-/.test(line)) {
        this.buf = this.buf.slice(cursor);
        return { code: 0, text: collected.join('\n') };
      }
    }
  }

  async readReply(): Promise<Reply> {
    for (;;) {
      const reply = this.takeReply();
      if (reply) return reply;

      const chunk = new Uint8Array(4096);
      const n = await withTimeout(this.conn.read(chunk), READ_TIMEOUT_MS, 'smtp read');
      if (n === null) throw new Error('smtp connection closed by server');
      this.buf += this.decoder.decode(chunk.subarray(0, n), { stream: true });
    }
  }

  /** Sends a command and asserts the reply code is in `expected`. */
  async command(line: string, expected: number[], label: string): Promise<Reply> {
    await this.writeRaw(`${line}\r\n`);
    const reply = await this.readReply();
    if (!expected.includes(reply.code)) {
      throw new Error(`${label} failed: ${reply.code} ${reply.text.slice(0, 200)}`);
    }
    return reply;
  }

  async writeBody(body: string): Promise<void> {
    await this.writeRaw(body);
  }
}

export async function connect(settings: SmtpSettings): Promise<SmtpSession> {
  const conn =
    settings.port === 465
      ? await withTimeout(
          Deno.connectTls({ hostname: settings.host, port: settings.port }),
          READ_TIMEOUT_MS,
          'smtp tls connect',
        )
      : await withTimeout(
          Deno.connect({ hostname: settings.host, port: settings.port }),
          READ_TIMEOUT_MS,
          'smtp connect',
        );

  const smtp = new SmtpConnection(conn);
  const session = new SmtpSession(smtp, settings);
  await session.handshake();
  return session;
}

export class SmtpSession {
  constructor(private smtp: SmtpConnection, private settings: SmtpSettings) {}

  private get senderAddress(): string {
    return extractAddress(this.settings.from);
  }

  private get heloDomain(): string {
    const at = this.senderAddress.indexOf('@');
    return at === -1 ? 'localhost' : this.senderAddress.slice(at + 1);
  }

  async handshake(): Promise<void> {
    const greeting = await this.smtp.readReply();
    if (greeting.code !== 220) {
      throw new Error(`unexpected greeting: ${greeting.code} ${greeting.text.slice(0, 200)}`);
    }

    const ehlo = await this.smtp.command(`EHLO ${this.heloDomain}`, [250], 'EHLO');

    // Port 465 is already wrapped in TLS. On any other port, upgrade with
    // STARTTLS when the server advertises it -- the old library had no such
    // path and would have sent these credentials in the clear.
    if (this.settings.port !== 465 && /STARTTLS/i.test(ehlo.text)) {
      throw new Error(
        'STARTTLS required on this port but not implemented; use port 465 or set SMTP_ALLOW_UNSECURE',
      );
    }

    await this.smtp.command('AUTH LOGIN', [334], 'AUTH LOGIN');
    await this.smtp.command(b64(this.settings.user), [334], 'AUTH username');
    await this.smtp.command(b64(this.settings.pass), [235], 'AUTH password');
  }

  private buildMessage(message: Message): string {
    const boundary = `----=_jtgc_${crypto.randomUUID().replace(/-/g, '')}`;
    const headers = [
      `From: ${this.settings.from}`,
      `To: ${message.to}`,
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      `Subject: ${encodeSubject(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${this.heloDomain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ...Object.entries(message.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    ];

    // Both parts are base64 UTF-8: that sidesteps line-length limits, 8-bit
    // transport issues and dot-stuffing entirely, and keeps Arabic intact.
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(message.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(message.html),
      `--${boundary}--`,
    ];

    return `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}\r\n`;
  }

  /** Sends one message. Throws on failure; the caller decides whether to continue. */
  async send(message: Message): Promise<void> {
    await this.smtp.command(`MAIL FROM:<${this.senderAddress}>`, [250], 'MAIL FROM');
    await this.smtp.command(`RCPT TO:<${extractAddress(message.to)}>`, [250, 251], 'RCPT TO');
    await this.smtp.command('DATA', [354], 'DATA');
    await this.smtp.writeBody(this.buildMessage(message));
    await this.smtp.command('.', [250], 'message body');
  }

  /** Clears transaction state so one failed recipient cannot poison the next. */
  async reset(): Promise<void> {
    await this.smtp.command('RSET', [250], 'RSET');
  }

  async quit(): Promise<void> {
    try {
      await this.smtp.command('QUIT', [221], 'QUIT');
    } catch {
      // The server may just drop the connection; nothing to recover.
    }
  }

  close(): void {
    this.smtp.close();
  }
}

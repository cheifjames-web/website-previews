const MAX_BODY_BYTES = 32_768;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FIELDS = new Set(['name', 'email', 'phone', 'message', 'website', 'turnstileToken']);
const TEST_KEY = /^[123]x0+/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(value);
}

export function configuration(env) {
  try {
    const origin = new URL(env.SITE_ORIGIN);
    const sender = env.CONTACT_FROM;
    const senderDomain = sender?.split('@')[1]?.toLowerCase();
    const hostname = origin.hostname.toLowerCase();
    const siteKey = env.TURNSTILE_SITE_KEY;
    const secret = env.TURNSTILE_SECRET_KEY;
    const business = env.BUSINESS_NAME;
    const reserved = /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost)$/;
    if (env.CONTACT_ENABLED !== 'true' || origin.protocol !== 'https:' ||
        origin.origin !== env.SITE_ORIGIN || reserved.test(hostname) ||
        !validEmail(env.CONTACT_TO) || !validEmail(sender) ||
        !(senderDomain === hostname || senderDomain?.endsWith('.' + hostname)) ||
        reserved.test(env.CONTACT_TO.split('@')[1].toLowerCase()) ||
        typeof business !== 'string' || !business || business.length > 120 || /[\r\n\x00-\x1f]/.test(business) ||
        typeof siteKey !== 'string' || typeof secret !== 'string' || !siteKey || !secret || TEST_KEY.test(siteKey) || TEST_KEY.test(secret) ||
        typeof env.CONTACT_EMAIL?.send !== 'function') return null;
    return { origin: origin.origin, hostname, business, siteKey, secret, sender, recipient: env.CONTACT_TO };
  } catch { return null; }
}

async function limitedJson(request) {
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw { status: 413 };
  if (!request.body) throw { status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw { status: 413 }; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw { status: 400 }; }
}

function parseSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.has(key))) return null;
  for (const key of ['name', 'email', 'phone', 'message', 'website', 'turnstileToken']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') return null;
  }
  const value = {
    name: body.name?.trim(), email: body.email?.trim(), phone: body.phone?.trim() || '',
    message: body.message?.trim(), token: body.turnstileToken,
  };
  if (!value.name || value.name.length > 120 || /[\r\n\x00-\x1f]/.test(value.name) ||
      !validEmail(value.email) || value.phone.length > 40 || /[\r\n\x00-\x1f]/.test(value.phone) ||
      !value.message || value.message.length < 10 || value.message.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.message) ||
      body.website?.trim() || !value.token || value.token.length > 2048) return null;
  return value;
}

export function createHandler({ verifyFetch = fetch } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (!['/api/contact', '/api/contact-config'].includes(url.pathname)) return json({ error: 'Not found.' }, 404);
    const config = configuration(env);
    if (!config) return json({ error: 'The message form is not available yet. Please call the business.' }, 503);
    if (url.origin !== config.origin) return json({ error: 'This site is not configured for messages.' }, 403);
    if (url.pathname === '/api/contact-config') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      return json({ enabled: true, siteKey: config.siteKey, action: 'contact' });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (request.headers.get('Origin') !== config.origin) return json({ error: 'Please submit the form from this website.' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Invalid form format.' }, 415);
    let body;
    try { body = await limitedJson(request); }
    catch (error) { return json({ error: error.status === 413 ? 'Your message is too long.' : 'Please check the form and try again.' }, error.status || 400); }
    const submission = parseSubmission(body);
    if (!submission) return json({ error: 'Please check your name, email and message, then try again.' }, 400);
    let verification;
    try {
      const response = await verifyFetch(SITEVERIFY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ secret: config.secret, response: submission.token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
      });
      if (!response.ok) throw new Error('Verification service unavailable');
      verification = await response.json();
    } catch { return json({ error: 'The security check is temporarily unavailable. Please try again or call us.' }, 503); }
    if (verification.success !== true || verification.hostname !== config.hostname || verification.action !== 'contact') {
      return json({ error: 'Please complete a fresh security check and try again.' }, 400);
    }
    try {
      const result = await env.CONTACT_EMAIL.send({
        from: { email: config.sender, name: config.business }, to: config.recipient,
        replyTo: { email: submission.email, name: submission.name },
        subject: `Website message for ${config.business}`,
        text: [
          `New message from the ${config.business} website`, '',
          `Name: ${submission.name}`, `Email: ${submission.email}`, `Phone: ${submission.phone || 'Not supplied'}`,
          '', 'Message:', submission.message,
        ].join('\n'),
      });
      if (!result?.messageId) throw new Error('No email acceptance receipt');
      return json({ accepted: true, message: 'Your message has been submitted. Thank you.' }, 202);
    } catch {
      return json({ error: 'We could not submit your message. Please call us instead.' }, 502);
    }
  };
}

export default { fetch: createHandler() };

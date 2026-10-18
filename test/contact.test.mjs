import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../cloudflare/worker.mjs';

const origin = 'https://unit-test-business.net';
function fixture(verification = {}) {
  const sent = [], verified = [];
  const env = { SITE_ORIGIN: origin, BUSINESS_NAME: 'Test Business', CONTACT_ENABLED: 'true',
    CONTACT_TO: 'owner@unit-test-inbox.net', CONTACT_FROM: 'forms@forms.unit-test-business.net',
    TURNSTILE_SITE_KEY: 'production-public-key-placeholder', TURNSTILE_SECRET_KEY: 'production-secret-placeholder',
    CONTACT_EMAIL: { async send(message) { sent.push(message); return { messageId: 'accepted-test-id' }; } } };
  const handler = createHandler({ verifyFetch: async (url, options) => {
    verified.push({ url, options });
    return Response.json({ success: true, hostname: 'unit-test-business.net', action: 'contact', ...verification });
  } });
  const body = { name: 'Test Visitor', email: 'visitor@unit-test-inbox.net', phone: '', message: 'Please tell me more about your work.', website: '', turnstileToken: 'single-use-token' };
  const request = (changes = {}, headers = {}) => new Request(origin + '/api/contact', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...changes }),
  });
  return { env, handler, body, request, sent, verified };
}

test('valid form sends only to the configured recipient, with visitor in Reply-To', async () => {
  const f = fixture();
  const response = await f.handler(f.request(), f.env);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, f.env.CONTACT_TO);
  assert.equal(f.sent[0].from.email, f.env.CONTACT_FROM);
  assert.equal(f.sent[0].replyTo.email, f.body.email);
  assert.match(f.sent[0].text, /Please tell me more/);
  assert.equal(f.sent[0].html, undefined);
});

test('client cannot inject a different recipient or headers', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request({ to: 'other@unit-test-inbox.net', bcc: 'other@unit-test-inbox.net' }), f.env)).status, 400);
  assert.equal((await f.handler(f.request({ name: 'Visitor\r\nBcc: other@unit-test-inbox.net' }), f.env)).status, 400);
  assert.equal(f.sent.length, 0);
});

test('wrong or missing origin cannot submit', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request({}, { Origin: 'https://another-business.net' }), f.env)).status, 403);
  const request = f.request(); request.headers.delete('Origin');
  assert.equal((await f.handler(request, f.env)).status, 403);
  assert.equal(f.verified.length, 0);
});

for (const verification of [{ success: false }, { hostname: 'another-business.net' }, { action: 'login' }]) {
  test(`server rejects invalid, replayed or wrong-site token: ${JSON.stringify(verification)}`, async () => {
    const f = fixture(verification);
    assert.equal((await f.handler(f.request(), f.env)).status, 400);
    assert.equal(f.sent.length, 0);
  });
}

test('honeypot and malformed visitor addresses never reach sending', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request({ website: 'spam-site' }), f.env)).status, 400);
  assert.equal((await f.handler(f.request({ email: 'not an address' }), f.env)).status, 400);
  assert.equal((await f.handler(f.request({ message: 'short' }), f.env)).status, 400);
  assert.equal(f.verified.length, 0);
});

test('malformed JSON and unsupported content types fail safely', async () => {
  const f = fixture();
  const request = new Request(origin + '/api/contact', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal((await f.handler(request, f.env)).status, 400);
  assert.equal((await f.handler(f.request({}, { 'Content-Type': 'text/plain' }), f.env)).status, 415);
  assert.equal(f.sent.length, 0);
});

test('chunked body is bounded even without Content-Length', async () => {
  const f = fixture();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(40_000))); controller.close(); } });
  const request = new Request(origin + '/api/contact', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body, duplex: 'half' });
  assert.equal((await f.handler(request, f.env)).status, 413);
  assert.equal(f.sent.length, 0);
});

test('preview/disabled deployment and dummy Turnstile keys fail closed', async () => {
  const f = fixture();
  for (const overrides of [{ CONTACT_ENABLED: 'false' }, { TURNSTILE_SECRET_KEY: '' }, { TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }, { CONTACT_TO: 'owner@example.com' }]) {
    assert.equal((await f.handler(f.request(), { ...f.env, ...overrides })).status, 503);
  }
  assert.equal(f.sent.length, 0);
});

test('public configuration exposes a site key, never recipient or secret', async () => {
  const f = fixture();
  const response = await f.handler(new Request(origin + '/api/contact-config'), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, siteKey: f.env.TURNSTILE_SITE_KEY, action: 'contact' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('provider failure or missing acceptance receipt never claims success or leaks details', async () => {
  const f = fixture();
  for (const send of [async () => { throw new Error('Private provider details'); }, async () => undefined]) {
    const response = await f.handler(f.request(), { ...f.env, CONTACT_EMAIL: { send } });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.doesNotMatch(text, /accepted|Private provider|owner@/);
  }
});

test('Turnstile outage never sends mail', async () => {
  const f = fixture();
  const handler = createHandler({ verifyFetch: async () => { throw new Error('network'); } });
  assert.equal((await handler(f.request(), f.env)).status, 503);
  assert.equal(f.sent.length, 0);
});

test('API routes stay distinct from static assets', async () => {
  const f = fixture();
  assert.equal((await f.handler(new Request(origin + '/api/contact'), f.env)).status, 405);
  assert.equal((await f.handler(new Request(origin + '/api/unknown'), f.env)).status, 404);
  const env = { ...f.env, ASSETS: { fetch: () => new Response('static page') } };
  assert.equal(await (await f.handler(new Request(origin + '/'), env)).text(), 'static page');
});

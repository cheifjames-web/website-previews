import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareClient } from '../scripts/prepare-client.mjs';

test('private client package serves only public assets, keeps recipient server-side and API worker-first', async () => {
  const base = resolve(tmpdir());
  const output = await mkdtemp(join(base, 'jb-client-form-test-'));
  try {
    const result = await prepareClient({ site: 'ec-plumbing', domain: 'client.example', recipient: 'owner@example.com', sender: 'forms@forms.client.example', mode: 'preview' }, output);
    const config = JSON.parse(await readFile(result.configPath, 'utf8'));
    const html = await readFile(join(result.directory, 'public', 'index.html'), 'utf8');
    assert.equal(config.assets.directory, './public');
    assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
    assert.equal(config.send_email[0].destination_address, 'owner@example.com');
    assert.equal(config.vars.CONTACT_ENABLED, 'false');
    assert.match(html, /data-contact-mode="preview"/);
    assert.match(html, /src="\/assets\/contact-form.js"/);
    assert.doesNotMatch(html, /owner@example.com|TURNSTILE_SECRET/);
    await assert.rejects(() => prepareClient({ site: 'ec-plumbing', domain: 'client.example', recipient: 'owner@example.com', sender: 'forms@forms.client.example', mode: 'preview' }, output), /already exists/);
  } finally {
    assert.ok(resolve(output).startsWith(base + sep) && output.includes('jb-client-form-test-'));
    await rm(output, { recursive: true, force: true });
  }
});

test('live package requires explicit client approval and recipient verification', async () => {
  await assert.rejects(() => prepareClient({ site: 'ec-plumbing', domain: 'client.example', recipient: 'owner@example.com', sender: 'forms@forms.client.example', mode: 'live' }, tmpdir()), /Live preparation requires/);
});

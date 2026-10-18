import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sites } from './sites.mjs';
import { validEmail } from '../cloudflare/worker.mjs';

export async function prepareClient(config, outputRoot) {
  const site = sites.find(item => item.id === config.site);
  if (!site) throw new Error('Select one of the four supported site IDs.');
  const domain = config.domain?.toLowerCase();
  if (!domain || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Use a domain name only, without https, paths, or Unicode.');
  if (!validEmail(config.recipient) || !validEmail(config.sender)) throw new Error('A valid designated recipient and domain sender are required.');
  const senderDomain = config.sender.split('@')[1].toLowerCase();
  if (senderDomain !== domain && !senderDomain.endsWith('.' + domain)) throw new Error('The sender must belong to this client domain or its mail subdomain.');
  if (!['preview', 'live'].includes(config.mode)) throw new Error('Mode must be preview or live.');
  if (config.mode === 'live' && (config.launchApproved !== true || config.recipientVerified !== true ||
      /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost)$/.test(domain) ||
      !/^[a-zA-Z0-9_-]{20,100}$/.test(config.turnstileSiteKey || '') || /^[123]x0+/.test(config.turnstileSiteKey))) {
    throw new Error('Live preparation requires launch approval, recipient verification, an actual domain, and a production Turnstile site key.');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const target = resolve(outputRoot, site.id);
  try { await access(target); throw new Error('Output already exists. Preserve/review it instead of overwriting a client deployment.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await readFile(join(root, site.id, 'index.html'), 'utf8');
  if (!source.includes('data-contact-form')) throw new Error('Run npm run forms:install first.');
  const html = source.replaceAll('../assets/contact-form', '/assets/contact-form')
    .replace('data-contact-mode="preview"', `data-contact-mode="${config.mode}"`);
  await mkdir(join(target, 'public', 'assets'), { recursive: true });
  await writeFile(join(target, 'public', 'index.html'), html, 'utf8');
  for (const asset of ['contact-form.css', 'contact-form.js']) await copyFile(join(root, 'assets', asset), join(target, 'public', 'assets', asset));
  const workerPath = fileURLToPath(new URL('../cloudflare/worker.mjs', import.meta.url));
  const relativeMain = relative(target, workerPath).replaceAll('\\', '/');
  const wrangler = {
    '$schema': '../../node_modules/wrangler/config-schema.json',
    name: `jb-${site.id}-contact`, main: relativeMain, compatibility_date: '2026-10-17', workers_dev: false,
    routes: [{ pattern: domain, custom_domain: true }],
    assets: { directory: './public', binding: 'ASSETS', run_worker_first: ['/api/*'] },
    send_email: [{ name: 'CONTACT_EMAIL', destination_address: config.recipient }],
    vars: { BUSINESS_NAME: site.name, SITE_ORIGIN: `https://${domain}`, CONTACT_TO: config.recipient,
      CONTACT_FROM: config.sender, CONTACT_ENABLED: config.mode === 'live' ? 'true' : 'false', TURNSTILE_SITE_KEY: config.turnstileSiteKey || '' },
    observability: { enabled: false },
  };
  await writeFile(join(target, 'wrangler.jsonc'), JSON.stringify(wrangler, null, 2) + '\n', 'utf8');
  return { directory: target, configPath: join(target, 'wrangler.jsonc'), mode: config.mode };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arg = process.argv.indexOf('--config');
    if (arg < 0 || !process.argv[arg + 1]) throw new Error('Usage: npm run client:prepare -- --config <private-client.json>');
    const config = JSON.parse(await readFile(resolve(process.argv[arg + 1]), 'utf8'));
    const result = await prepareClient(config, fileURLToPath(new URL('../clients/', import.meta.url)));
    console.log(`Prepared ${result.mode} package: ${result.directory}`);
    console.log('Not deployed. Domain ownership, DNS, destination verification and a real receipt test remain launch steps.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

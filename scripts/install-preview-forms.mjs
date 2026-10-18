import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sites } from './sites.mjs';

const root = new URL('../', import.meta.url);
for (const site of sites) {
  const path = new URL(`${site.id}/index.html`, root);
  let html = await readFile(path, 'utf8');
  if (html.includes('data-contact-form')) {
    if (!html.includes('id="contact" data-contact-form')) {
      await writeFile(path, html.replace('<section data-contact-form', '<section id="contact" data-contact-form'), 'utf8');
    }
    continue;
  }
  if (!html.includes('</head>') || !html.includes('</body>') || !/<footer[\s>]/i.test(html)) throw new Error(`Cannot safely locate form position: ${site.id}`);
  html = html.replace('</head>', '  <link rel="stylesheet" href="../assets/contact-form.css">\n</head>');
  html = html.replace(/<footer(?=[\s>])/i, `<section id="contact" data-contact-form data-contact-mode="preview" style="--form-accent:${site.accent}" aria-label="Contact form preview"><noscript>The message form needs JavaScript. Use the contact details or profile links on this page.</noscript></section>\n<footer`);
  html = html.replace('</body>', '  <script src="../assets/contact-form.js" defer></script>\n</body>');
  await writeFile(path, html, 'utf8');
  console.log(`Added preview-only form: ${fileURLToPath(path)}`);
}

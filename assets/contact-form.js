(() => {
  const mount = document.querySelector('[data-contact-form]');
  if (!mount) return;
  const preview = mount.dataset.contactMode !== 'live';
  mount.classList.add('jb-contact');
  mount.innerHTML = `
    <h2>Send a message</h2>
    ${preview ? '<p class="jb-demo">Preview form — messages are not sent.</p>' : '<p>Send us your question and the best way to reach you.</p>'}
    <form method="post">
      <label>Your name <input name="name" autocomplete="name" maxlength="120" required></label>
      <label>Email address <input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label class="jb-wide">Phone (optional)<input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
      <label class="jb-wide">Message <textarea name="message" minlength="10" maxlength="5000" required></textarea></label>
      <label class="jb-trap" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="jb-wide" data-turnstile></div>
      <p class="jb-privacy">${preview ? 'This preview does not submit your details.' : 'Your contact details are used to reply to your message. Please do not include sensitive information.'}</p>
      <button type="submit" disabled>${preview ? 'Try the preview form' : 'Send message'}</button>
      <p class="jb-status" role="status" aria-live="polite" tabindex="-1"></p>
    </form>`;
  const form = mount.querySelector('form');
  const button = mount.querySelector('button');
  const status = mount.querySelector('[role="status"]');
  let token = '';
  let widget;
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (preview) {
      status.textContent = 'Preview complete — no message was sent. The business’s chosen inbox is connected when the site launches.';
      status.focus();
      return;
    }
    if (!token) { status.textContent = 'Please complete the security check first.'; return; }
    busy = true;
    button.disabled = true;
    status.textContent = 'Submitting your message…';
    try {
      const values = new FormData(form);
      const response = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ name: values.get('name'), email: values.get('email'), phone: values.get('phone'), message: values.get('message'), website: values.get('website'), turnstileToken: token }),
      });
      const result = await response.json();
      if (!response.ok || result.accepted !== true) throw new Error(result.error || 'We could not submit your message. Please call us instead.');
      status.textContent = result.message;
      form.reset();
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'We could not confirm submission. Please call us before trying again.' :
        error instanceof TypeError ? 'We could not connect. Please try again or call us.' : error.message;
    } finally {
      busy = false;
      token = '';
      if (widget !== undefined) window.turnstile.reset(widget);
      button.disabled = true;
      status.focus();
    }
  });
  if (preview) { button.disabled = false; return; }
  (async () => {
    try {
      const response = await fetch('/api/contact-config', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const config = await response.json();
      if (!response.ok || config.enabled !== true) throw new Error('Unavailable');
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onerror = () => { status.textContent = 'The message form is temporarily unavailable. Please call us.'; };
      script.onload = () => {
        widget = window.turnstile.render(mount.querySelector('[data-turnstile]'), {
          sitekey: config.siteKey, action: config.action,
          callback: value => { token = value; button.disabled = busy; },
          'expired-callback': () => { token = ''; button.disabled = true; },
          'error-callback': () => { token = ''; button.disabled = true; status.textContent = 'The security check could not finish. Please try again or call us.'; },
        });
      };
      document.head.append(script);
    } catch { status.textContent = 'The message form is not available yet. Please call us.'; }
  })();
})();

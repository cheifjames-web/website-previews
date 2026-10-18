# Client domain and contact-form setup

This is a reusable launch package. The four public design previews have demo forms that send nothing. A live client needs their own approved domain, Cloudflare access, designated inbox and completed verification. No domain purchase, DNS change, account/plan activation, or real email is performed by the preparation script.

## Domain ownership

1. Ask whether the client already owns a domain and record who controls its registrar, DNS and email. A missing website does not mean a missing domain.
2. If there is no domain, use Cloudflare Registrar in the **client's account and registrant name**. Review the exact spelling, availability, registration and renewal prices, term, contact details and auto-renew with the client before purchase. Domain costs are quoted separately unless James explicitly includes them; the existing website prices are not changed by this package.
3. If a domain exists, keep the registrar and ownership. This Worker custom-domain setup needs the domain in Cloudflare DNS. Prepare any nameserver/DNS migration only after inventorying existing records and obtaining approval. Preserve mail-related MX, SPF, DKIM and DMARC records. Do not change another service just to enable a form.
4. A production domain is connected to a dedicated Worker for that client, with its static HTML and assets. Use a canonical HTTPS hostname; set up a separately reviewed www/apex redirect if needed. Preview disclaimers remain until the owner approves the actual launch.

## The receiving email

The business chooses the inbox that receives enquiries. It can be a business mailbox or Gmail. Each client deployment has a **single fixed recipient** in server-side configuration and a Cloudflare binding restricted to that same address. The visitor supplies their own email only as Reply-To. The form cannot choose To, Cc, Bcc, sender or subject.

Verify that inbox as a destination in the client's Cloudflare account, with the client's authorization. Cloudflare currently permits sending to verified destination addresses on its free plans. Arbitrary recipients require paid Email Sending; this template does not enable that or buy a plan. Verify current plan/usage limits before quoting ongoing costs.

The sender must be on an onboarded client email domain. For a client with existing mail, consider a dedicated `forms.<client-domain>` mail subdomain and review the precise Cloudflare requirements before adding records. Do not replace the client's working root MX records or overwrite an existing DMARC policy. Email Sending and Email Routing have different DNS requirements. Cloudflare forwarding is not a hosted mailbox.

## Prepare one client (local only)

Install dependencies with `npm ci`. Copy `cloudflare/client.example.json` to a **private file outside the public source**, then fill in the selected site, canonical domain, recipient, sender and public Turnstile site key. The available source IDs are:

- `birrieria-guadalajara`
- `taco-shop-mexican-grill`
- `ec-plumbing`
- `el-palacio`

Keep `mode: "preview"` until the owner approves launch and the recipient is verified. For live preparation set `mode: "live"`, `launchApproved: true`, and `recipientVerified: true` only after those steps actually happen. These flags record operator confirmation; they do not independently verify Cloudflare state.

```powershell
npm run client:prepare -- --config C:\private\client.json
npx wrangler deploy --dry-run --config clients/<site-id>/wrangler.jsonc
```

The generated `clients/<site-id>/` directory is Git-ignored and must stay private. It contains only the public page/assets plus a separate server configuration. The output will not overwrite an existing client package. Review/archive the earlier package before generating a replacement. The API worker runs before assets for `/api/*`; static pages load directly without the Muse wrapper.

## Configure and deploy after approval

1. Sign into the client's existing authorized Cloudflare account and confirm the zone/account identity. Do not expose credentials in chat or source.
2. Create a production Turnstile widget restricted to the canonical hostname. Put the public site key in the private client configuration. The Worker checks the token's success, hostname and `contact` action; test keys are rejected in production.
3. Verify the destination inbox and sender-domain setup in Cloudflare. Confirm that `destination_address`, `CONTACT_TO`, and the chosen client inbox agree. A mismatch must fail, not fall back to a different recipient.
4. Store `TURNSTILE_SECRET_KEY` with `wrangler secret put TURNSTILE_SECRET_KEY --config clients/<site-id>/wrangler.jsonc`. Never put it into HTML, Git, a config example or a public build directory.
5. Review the generated domain route and plan/cost implications, then deploy with the approved account: `npx wrangler deploy --config clients/<site-id>/wrangler.jsonc`. This may create/update the custom-domain DNS route; do not run it without the domain owner's approval.
6. Use a synthetic visitor name/email/message for an authorized real submission. Confirm the designated inbox receives it, the reply action targets the visitor, the sender authentication is correct, and no other inbox receives it. A provider acceptance response is **not** proof of inbox delivery.
7. Test invalid addresses, a failed/expired token and an unavailable mail service. The form must show an error and preserve the phone fallback, never a false success. Confirm desktop/mobile layout and real-client privacy wording before launch.

The form accepts bounded text, verifies Turnstile on the server, rejects a honeypot and unexpected fields, checks same-origin submissions, and waits for email-provider acceptance before showing submission success. It sends plain text, does not save enquiries to a database, and does not automatically retry ambiguous delivery failures. Do not claim inbox delivery, retention policy, 24/7 monitoring or a response-time guarantee from this code alone.

## Validation

`npm test` covers routing, fixed recipients, Reply-To, origin/size/input validation, token hostname/action failures, disabled deployments and provider failures with in-memory mail and verification doubles. It sends **no real email**. `npm run dev:preview` serves the four demo forms on loopback for browser checks. Wrangler dry-run validates packaging and bindings; it is not a live email or DNS test.

## Current primary references

- [Cloudflare Registrar registration](https://developers.cloudflare.com/registrar/get-started/register-domain/)
- [Email binding and structured send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Restricting email recipients](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Sender and routing DNS requirements](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Workers static-asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

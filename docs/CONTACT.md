# The contact form

`/contact` has a **Message** row under the links (and a `message` command in the terminal) that opens a form:
name, email, message. What happens when a visitor presses the button depends on whether this deployment can send
email.

| The Worker has… | The button says | What happens |
| --- | --- | --- |
| a `CONTACT_EMAIL` `send_email` binding | **Send message** | The Worker sends the message as an email to the contact address. The page says "sent" only after Cloudflare accepted it. |
| no binding (today, and in local development) | **Open in my mail app** | The visitor's mail app opens with the message, subject and address filled in; they press send there. |

If sending fails, or a visitor goes over the limit, the form falls back to the mail app with the message intact. It
never shows "sent" for something that was not handed to the mail service.

## Turning on real delivery (free, about 5 minutes)

Cloudflare Email Routing is free and is what lets a Worker send to your inbox. Everything happens in your Cloudflare
account; no new service or API key is needed.

1. **Enable Email Routing** for `alenewport.com`: Cloudflare dashboard → *alenewport.com* → *Email* → *Email Routing* →
   *Get started / Enable*. Let it add the DNS records it proposes (MX and an SPF `TXT`). The domain has no mail
   records today, so nothing else is affected.
2. **Verify the destination**: *Email Routing* → *Destination addresses* → add `ale.newport.diaz@gmail.com`, then open
   the verification email in that inbox and confirm.
3. **Add the binding** to `wrangler.jsonc` (inside the top-level object) and push to `main`:

   ```jsonc
   // The contact form sends through Email Routing (docs/CONTACT.md). The address must be verified there first.
   "send_email": [{ "name": "CONTACT_EMAIL", "destination_address": "ale.newport.diaz@gmail.com" }]
   ```

   Do this only after steps 1 and 2: Cloudflare can reject a deployment whose `send_email` destination is not a
   verified address.
4. **Check it**: open <https://www.alenewport.com/api/contact>. It should answer
   `{"delivery":"email",…}`. Then send yourself a message from `/contact`.

Optional Worker variables: `CONTACT_FROM` (default `contact@alenewport.com`, which must be on the Email Routing
domain) and `CONTACT_TO` (default: the address of the Email link in the published site).

## Abuse protection

- Requests must come from a page of this site (`Origin` and `Sec-Fetch-Site` checked); bodies over 16 kB are refused.
- A hidden field that people never see; a bot that fills it in is refused (openly, not with a fake success).
- Name ≤ 100, email ≤ 200, message 10–5000 characters; line breaks and control characters can never reach a mail
  header, and non-ASCII names are encoded (RFC 2047).
- **Limits**, counted in the database so they hold across Worker isolates: 3 messages per hour per visitor address
  (stored as a salted hash, never the IP itself) and 40 per day for the whole site. They reuse the `login_attempts`
  table under `contact:` keys, so no migration is needed.
- If the limit store is unreachable, the form falls back to the mail app rather than sending without limits.

## How it was verified

- `tests/server/contact.test.mjs`: validation, header injection, MIME output, the `mailto:` fallback, the limits, and
  that nothing claims it can send without the binding.
- On local workerd (`wrangler dev` with a `send_email` binding and a throwaway Postgres): three messages were accepted
  by the binding and written as `.eml` files that parse correctly (UTF-8 subject, `Reply-To` the visitor). The fourth
  was refused with 429, and the form fell back to the mail app.

Code: `src/server/contact.ts`, `src/app/api/contact/route.ts`, `src/components/contact/ContactForm.tsx`.

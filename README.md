# TurnoListo

**Caribbean AI Summit Healthcare Hackathon 2026 prototype**, now running on real (non-demo) data with username accounts.

In Puerto Rico, patients wait months for a specialist while appointment slots freed up by cancellations go unused, because clinic staff have no time to find someone to fill them. TurnoListo lets patients request a specialist **by voice**, as an **anonymous request** (specialty, area, insurance plan, no diagnosis). Clinics post open slots at the end of the day, and TurnoListo automatically offers each slot **by SMS** to the eligible patient who has waited longest. The clinic sees the patient's name and phone only after the patient accepts.

The app starts **empty**: every account, clinic, request and slot is real data created through the app. There is no demo seed.

## Quick start

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env      # optional: add an LLM key / Twilio credentials
npm run dev               # then open http://localhost:5173
```

Data is stored in `data/turnolisto.json` (created on first use, git-ignored). To wipe everything, stop the server and delete that file.

For a production-style run: `npm run build && npm start` (serves on http://localhost:3000).

## Accounts (username only, no password)

| Role | How to get in | Lands on |
|---|---|---|
| **Patient** | Enter a username on `/` (tab *Paciente*). The account is created the first time. | `/paciente` (their requests) |
| **Clinic** | Register once at `/registro-oficina` (username, name, specialty, town, address, accepted plans). Afterwards sign in on `/` (tab *Oficina*) with that username. | `/oficina` (its own slots only) |

Usernames are 3–24 characters (`a-z`, `0-9`, `.`, `-`, `_`), case-insensitive, and unique across patients and clinics. A clinic account is tied to exactly one clinic, and the clinic is always taken from the session, never from the URL or form.

## Real workflow

1. **Clinic** registers, then publishes open slots (voice or manual form) on `/oficina`.
2. **Patient** signs in, goes to *Nueva solicitud* (`/nueva`), and asks for a specialist by voice or text. Name and phone are remembered for next time. One active request per specialty and region.
3. TurnoListo offers each slot **by SMS** to the eligible patient who has waited longest. The patient replies SI / NO (or free text).
4. On SI the slot is booked and the clinic sees the patient's name and phone for the first time.
5. Patients follow everything on `/paciente` and can cancel a request. `/sms` shows only that patient's own messages and lets them reply when `SMS_MODE=simulated`. With `SMS_MODE=twilio`, real texts are sent and replies arrive through the webhook.

## How it works

| Piece | Where |
|---|---|
| Voice input / spoken replies (browser Web Speech API, free) | `src/lib/voice.svelte.ts` |
| AI: speech → anonymous request, SMS reply intent, clinic voice commands | `src/lib/server/ai.ts` |
| LLM API wrapper (Anthropic or OpenAI) | `src/lib/server/llm.ts` |
| Matching, offers, expiry, booking | `src/lib/server/matcher.ts` |
| SMS sending (simulated + Twilio) | `src/lib/server/sms.ts` |
| JSON-file data store, users and sessions | `src/lib/server/store.ts` |
| Username sign-in / cookie session | `src/lib/server/auth.ts`, `src/hooks.server.ts` |
| Twilio inbound webhook | `src/routes/api/sms/inbound/+server.ts` |

**Matching rule.** For an open slot, eligible requests have the same specialty and region, are waiting, and have a plan the clinic accepts for that slot. The slot is offered to the one with the oldest `createdAt`. Clinics never browse or choose patients, which prevents cherry-picking by insurance plan.

**AI without an API key.** Every AI task has a rule-based parser, so the demo works offline and with no key. When `LLM_API_KEY` is set, the model handles messier phrasing. Its output is always checked against fixed lists (specialties, regions, plans) before it is used.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic` (default) or `openai` |
| `LLM_API_KEY` | API key. Leave empty to run with the rule-based parser only |
| `LLM_MODEL` | Model name. Defaults: `claude-haiku-5-5` (Anthropic) or `gpt-4o-mini` (OpenAI); set your own if those aren't available to you |
| `SMS_MODE` | `simulated` (default; messages only appear in `/sms`) or `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Needed for `SMS_MODE=twilio` |

### Real SMS with Twilio

1. Set `SMS_MODE=twilio` and the three Twilio variables. Trial accounts can only text **verified** numbers.
2. Expose your server with a tunnel, e.g. `ngrok http 5173` (dev) or `ngrok http 3000` (after `npm start`).
3. In the Twilio console, set your number's **"A message comes in"** webhook to `https://<your-tunnel>/api/sms/inbound` (HTTP POST).
4. When a patient registers with your verified phone, offers arrive as real texts and your replies come back through the webhook.

`server.js` exists because SvelteKit's production server assumes https and rejects form POSTs without an `Origin` header (which Twilio doesn't send). It fixes both for this one route.

## Privacy and safety choices

- Requests store only specialty, area, plan, preferred days and whether the patient has a referral. **No diagnosis or symptoms**: the AI is instructed to drop them, and they are never saved.
- The patient's **name and phone are not sent to the AI**; they are typed into a separate form after the AI part.
- Clinics see patient identity **only after the patient accepts** a slot by SMS.
- The AI never gives medical advice, decides urgency, or picks a specialty from symptoms. If someone describes an emergency, it tells them to call **911** or **Línea PAS (1-800-981-0023) / 988**.

## Limitations

- Storage is a single JSON file, not a production database.
- Sign-in is **username only, with no password**: anyone who knows a username can sign in as that user, and anyone can register a clinic. A real launch needs a second factor (e.g. an SMS code) and clinic verification (e.g. against the NPI registry).
- A real launch needs HIPAA-compliant hosting and business associate agreements with the AI and SMS providers.
- Twilio webhook signatures are not validated yet.
- Patients may still need a referral from their primary care doctor. TurnoListo finds the slot; it doesn't replace that paperwork.
- Browser speech recognition works best in Chrome/Edge; there is always a text fallback.
- Next steps: a phone-call voice line for patients without smartphones, and partnering with insurers or provider groups to onboard their networks.

## Tech

SvelteKit 3 + Svelte 5 (runes), TypeScript, Tailwind CSS v4, `@sveltejs/adapter-node`.
Note: SvelteKit 3 uses `#lib/...` imports instead of `$lib/...`.

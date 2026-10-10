# TurnoListo

**Caribbean AI Summit Healthcare Hackathon 2026 prototype**, now running on real (non-demo) data with username accounts.

In Puerto Rico, patients wait months for a specialist while appointment slots freed up by cancellations go unused, because clinic staff have no time to find someone to fill them. TurnoListo lets patients request a specialist **by voice**, as an **anonymous request** (specialty, area, insurance plan, no diagnosis). The AI assistant then checks the registered clinics and **reads out up to 3 real openings**, closest first, and the patient says which one they want. If nothing is open, the patient joins a **waiting list** and TurnoListo alerts them **by SMS** (or in the app) the moment a matching slot opens, starting with the patient who has waited longest. Clinics publish open slots **by voice** or form, and see the patient's name and phone only after a booking.

The app starts **empty**: every account, clinic, request and slot is real data created through the app. There is no demo seed.

---

## At a glance (slide-ready)

| | |
|---|---|
| **Who uses it** | Patients and medical offices (clinics) |
| **Patient gets** | A voice assistant that finds up to 3 nearby openings, books by voice, joins a waitlist, SMS or in-app alerts |
| **Clinic gets** | Voice or form slot publishing, filled slots with no phone tag, cancellation tools, no cherry-picking of patients |
| **AI does** | Understands speech, fills the request, searches real slots, reads them aloud, books the chosen one |
| **AI never does** | Medical advice, urgency decisions, picking a specialty from symptoms, naming doctors that are not registered |
| **Privacy** | No diagnosis stored. Clinic sees name and phone only after booking. Patient location is never shared with clinics |
| **Language** | Spanish interface and voice |
| **Tech** | SvelteKit 3, Svelte 5, TypeScript, Tailwind v4, Gemini Live (voice), Twilio (SMS), Turso (database), Vercel (hosting) |

---

## All features

### Patient

| # | Feature | What it does |
|---|---|---|
| 1 | **Username sign-in** | Enter a username on `/`; the account is created the first time. No password. |
| 2 | **Profile** (`/perfil`) | Name, phone, **SMS alerts on/off**, and **current location** (latitude/longitude, or one tap on "Usar mi ubicación"). New patients are sent here first; requesting a specialist needs name and phone. |
| 3 | **Live voice assistant** (`/nueva`) | One round mic button: tap to talk, tap again to end. The AI asks one question at a time for specialty, town or area, plan, preferred days and whether the patient has a referral. |
| 4 | **Instant openings (top 3)** | When the request is complete, the assistant searches real open slots and reads up to **3**, with clinic, town, distance in miles, date and time. The same 3 appear as cards on screen. |
| 5 | **Pick by voice or tap** | Say "el número 2" or tap **Reservar**. The slot is re-checked at the moment of booking, so a slot taken by someone else is never double-booked. |
| 6 | **Waiting list** | If nothing is open (or none of the 3 fits), the AI offers to put the patient on the waiting list. When a matching slot opens, the patient who has waited longest is alerted. |
| 7 | **Distance in miles** | Straight-line distance between the patient's location and the clinic. Closest openings come first. |
| 8 | **SMS or in-app alerts** | With SMS alerts on, offers arrive by text and the patient replies SI / NO (or free text such as "mas tarde"). With alerts off, the offer shows in the app with **Reservar** and **No, gracias** buttons. |
| 9 | **My requests** (`/paciente`) | Every request with its status: waiting (with place in line), offered, booked, cancelled. |
| 10 | **Request detail** (`/solicitud/[code]`) | Live status, place in line, offered or booked slot with clinic address, and what the clinic can see about them. Refreshes automatically. |
| 11 | **Cancel an appointment** | Patients can cancel a waiting request, a pending offer or a booked appointment. A cancelled appointment goes back to open and is offered to the next person in line. Past appointments cannot be cancelled. |
| 12 | **Remove requests** | Cancelled requests can be removed one by one or all at once. Active, offered and booked requests must be cancelled first, so nothing live is deleted by accident. |
| 13 | **Clinic-cancelled notice** | If a clinic cancels a booked appointment, the patient goes back in line with their original place, gets an SMS (if alerts are on) and a notice in the app. |
| 14 | **SMS inbox** (`/sms`) | The patient's own messages only, plus a reply box when `SMS_MODE=simulated`. |
| 15 | **Typed fallback** | Without a Gemini key, the page falls back to a browser-mic and typed chat that still shows the openings cards. |

### Clinic (medical office)

| # | Feature | What it does |
|---|---|---|
| 1 | **Registration** (`/registro-oficina`) | Username, office name, specialty, town, address, accepted insurance plans, optional **coordinates** (or "use this device's location"). |
| 2 | **Open slots by voice** (`/oficina`) | One round mic button. Say "Abre tres turnos el martes de 2 a 4" and the slots are published. The session ends by itself after 6 seconds of silence. |
| 3 | **Manual publishing** | Form with date, from, to and slot length (20, 30, 40 or 60 minutes). Up to 24 slots at once. Past times and duplicates are skipped. |
| 4 | **Accepted plans** | Edit which insurance plans the office accepts; open slots update immediately. |
| 5 | **Office location** | Save latitude and longitude so patients see the exact distance. Without it, the town center is used. |
| 6 | **Slot board** | Each slot shows open, offered (with minutes left) or booked, with the patient's name, phone, plan and referral status **only after booking**. |
| 7 | **Demand panel** | How many patients are waiting for this specialty in this area with a plan the office accepts, and how many wait with plans it does not accept. |
| 8 | **Remove an open slot** | Open slots can be taken off the board. |
| 9 | **Cancel a booked appointment** | The slot is deleted, the patient is told and goes back in line. The office can publish the time again if it becomes available. |
| 10 | **No cherry-picking** | Clinics never browse or choose patients, so insurance-based selection is impossible. |

### Matching engine

| Rule | Detail |
|---|---|
| **Instant search** | A slot qualifies if the clinic's specialty matches, the slot accepts the patient's plan, and the clinic is in the **same region or within 25 miles**. |
| **Ranking** | Closest first, then soonest. Up to 3 are shown. |
| **Waitlist offers** | When a slot opens, it is offered to the eligible waiting patient with the **oldest request** (first come, first served). |
| **Offer window** | Patients have **30 minutes** to accept. After that the offer expires and the slot goes to the next person. |
| **Declined or expired** | The patient keeps their place in line. |
| **Freed slots** | A slot freed by a patient cancelling is offered again right away. |
| **One active request** | One active request per specialty per patient. |

### AI assistant (Gemini Live)

| Feature | Detail |
|---|---|
| **Real-time voice** | The browser talks to Gemini Live directly using a short-lived, single-use token, so the real API key never reaches the browser. |
| **Tools it can call** | `update_request` (save what the patient said), `find_openings`, `choose_opening`, `join_waitlist` (patient) and `publish_slots` (clinic). |
| **Stays inside the system** | It may only mention clinics, times and distances returned by the search. It must never suggest doctors, hospitals or phone numbers that are not registered. If nothing is open it offers the waitlist instead. |
| **Emergency handling** | If someone describes an emergency, the assistant tells them to call **911** or **Línea PAS (1-800-981-0023) / 988**. |
| **Silence timeout** | The session closes after 6 seconds without speech from either side. |
| **Rule-based fallback** | Every AI task also has a rule-based parser, so the app works with no AI key at all. |

---

## Patient journey (step by step)

1. **Sign in** with a username. First-time patients complete their **profile**: name, phone, SMS preference, location.
2. Open **Nueva solicitud** and tap the mic: "Necesito un cardiólogo en Arecibo, tengo Triple-S."
3. The AI asks for what is missing: area, days, referral.
4. The AI **searches real slots** and reads up to 3 openings with distance.
5. **Openings found:** the patient says "el número 2". The slot is booked, the clinic sees their name and phone for the first time, and the patient gets a confirmation (SMS if alerts are on).
6. **Nothing open:** the patient joins the **waiting list**.
7. A slot opens later: the longest-waiting matching patient gets an **SMS or in-app alert** and has 30 minutes to accept by replying SI or tapping **Reservar**.
8. The patient can **cancel** at any time. The slot is released to the next person.

## Clinic journey (step by step)

1. **Register** the office once, with specialty, town, accepted plans and optional exact location.
2. **Publish open slots** by voice or form, usually at the end of the day.
3. TurnoListo fills them: patients book directly from the top-3 list, or the waitlist gets alerted.
4. The office sees **booked patients** (name, phone, plan, referral) and demand in its area.
5. If something comes up, the office **cancels** the appointment. The patient is told and kept in line.

---

## Quick start

Requires Node.js 22 or newer.

```bash
pnpm install
cp .env.example .env      # optional: add Gemini / Twilio / Turso credentials
pnpm dev                  # then open http://localhost:5173
```

- **Local data:** with no Turso settings, everything is stored in `data/turnolisto.json` (created on first use, git-ignored). To wipe it, stop the server and delete that file.
- **Type-check:** `pnpm check`.
- **Build:** `pnpm build`. The project uses `@sveltejs/adapter-vercel`.

## Accounts (username only, no password)

| Role | How to get in | Lands on |
|---|---|---|
| **Patient** | Enter a username on `/` (tab *Paciente*). The account is created the first time. New patients go to `/perfil` first. | `/paciente` (their requests) |
| **Clinic** | Register once at `/registro-oficina`. Afterwards sign in on `/` (tab *Oficina*) with that username. | `/oficina` (its own slots only) |

Usernames are 3 to 24 characters (`a-z`, `0-9`, `.`, `-`, `_`), case-insensitive, and unique across patients and clinics. A clinic account is tied to exactly one clinic, and the clinic is always taken from the session, never from the URL or form.

## Pages and endpoints

| Route | Who | Purpose |
|---|---|---|
| `/` | Everyone | Sign in (patient or clinic tab) |
| `/registro-oficina` | New clinics | Register an office |
| `/perfil` | Patient | Name, phone, SMS alerts, location |
| `/nueva` | Patient | Live voice request, top-3 openings, waitlist |
| `/paciente` | Patient | All requests, remove cancelled ones |
| `/solicitud/[code]` | Patient | One request: status, accept or decline offer, cancel, remove |
| `/sms` | Patient | Own SMS thread (simulator reply when `SMS_MODE=simulated`) |
| `/oficina` | Clinic | Publish slots, plans, location, slot board, cancel bookings |
| `/api/live/token` | Signed in | Mints the short-lived Gemini Live token |
| `/api/live/tool` | Signed in | Runs the AI's tool calls with the user's own session |
| `/api/openings` | Patient | Top-3 search for the typed fallback |
| `/api/intake` | Patient | Rule-based or LLM intake for the typed fallback |
| `/api/sms/inbound` | Twilio | Inbound SMS webhook |

## How it works

| Piece | Where |
|---|---|
| Live voice component (mic toggle, silence timeout, audio in and out) | `src/lib/components/LiveAssistant.svelte` |
| Gemini Live prompts, tools and model | `src/lib/server/liveConfig.js` |
| Token endpoint and tool runner | `src/routes/api/live/token/+server.ts`, `src/routes/api/live/tool/+server.ts` |
| Browser speech fallback | `src/lib/voice.svelte.ts` |
| AI: speech to anonymous request, SMS reply intent, clinic commands | `src/lib/server/ai.ts` |
| LLM API wrapper (Anthropic, OpenAI, OpenRouter, Ollama) | `src/lib/server/llm.ts` |
| Matching, openings search, booking, cancellation, offers, expiry | `src/lib/server/matcher.ts` |
| Distances and coordinates | `src/lib/geo.ts`, `src/lib/server/places.ts`, town centers in `src/lib/constants.ts` |
| SMS sending (simulated and Twilio), SMS-off handling | `src/lib/server/sms.ts` |
| Data store (Turso or local JSON), users and sessions | `src/lib/server/store.ts` |
| Username sign-in and cookie session | `src/lib/server/auth.ts`, `src/hooks.server.ts` |
| Slot publishing | `src/lib/server/slots.ts` |

**AI without an API key.** Every AI task has a rule-based parser, so the app works with no key. When a model is configured it handles messier phrasing. Its output is always checked against fixed lists (specialties, regions, plans) before it is used.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Enables the live voice assistant (patient and clinic). Without it the typed and browser-mic fallback is used. |
| `GEMINI_LIVE_MODEL` | Optional override of the Gemini Live model |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | Optional LLM for the typed fallback and clinic commands (`anthropic`, `openai`, `openrouter`, `ollama`). Empty means rule-based only |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OLLAMA_HOST`, `OLLAMA_MODEL` | Provider-specific settings |
| `SMS_MODE` | `simulated` (default; messages only appear in `/sms`) or `twilio` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Needed for `SMS_MODE=twilio` |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Database. **Required on Vercel**; leave empty locally to use the JSON file |

### Real SMS with Twilio

1. Set `SMS_MODE=twilio` and the three Twilio variables. Trial accounts can only text **verified** numbers.
2. Make the app reachable from the internet (a tunnel such as `ngrok http 5173` in dev, or your Vercel URL).
3. In the Twilio console, set your number's **"A message comes in"** webhook to `https://<your-url>/api/sms/inbound` (HTTP POST).
4. When a patient registers with your verified phone, offers arrive as real texts and replies come back through the webhook.

## Privacy and safety choices

- Requests store only specialty, area, plan, preferred days and whether the patient has a referral. **No diagnosis or symptoms**: the AI is instructed to drop them, and they are never saved.
- The patient's **name and phone are not sent to the AI**. They come from the profile, not from the conversation.
- Clinics see patient identity **only after a booking**. The patient's **location is never shared** with clinics.
- The AI never gives medical advice, decides urgency, or picks a specialty from symptoms. Emergencies are redirected to **911** or **Línea PAS (1-800-981-0023) / 988**.
- The AI can only talk about clinics and openings registered in TurnoListo. A made-up doctor could never be booked, because bookings only go through real slot IDs.
- The Gemini API key stays on the server. The browser gets a **single-use token** that expires in minutes, with the prompt and tools locked inside it.

## Limitations

- Distances are **straight-line miles**, not driving distance. Without exact coordinates, the town center is used.
- The 25-mile nearby radius is fixed in the code; patients cannot set their own limit yet.
- The database is a single JSON document (in Turso or a local file), not a full relational database.
- Sign-in is **username only, with no password**: anyone who knows a username can sign in as that user, and anyone can register a clinic. A real launch needs a second factor (for example an SMS code) and clinic verification (for example against the NPI registry).
- A real launch needs HIPAA-compliant hosting and business associate agreements with the AI and SMS providers.
- Twilio webhook signatures are not validated yet.
- Patients may still need a referral from their primary care doctor. TurnoListo finds the slot; it does not replace that paperwork.
- Voice models can occasionally ignore instructions. The prompts and the scripted opening text reduce this but cannot remove it.
- Clinics cannot give a reason when cancelling, and are not notified when a patient cancels (the slot just shows as open again).
- A booked appointment does not block a new request in the same specialty.

## Roadmap

- A phone-call voice line for patients without smartphones.
- Day-based booking for offices that work first come, first served without exact times, with a daily arrival cap.
- Patient-chosen maximum distance.
- Two-factor sign-in and clinic verification.
- Partnerships with insurers and provider groups to onboard their networks.


## Working vs. simulated

| Feature | Status |
|---|---|
| Voice request, top-3 openings, voice booking (Gemini Live) | Working |
| Waitlist matching, 30-minute offers, expiry, cancellations | Working |
| Clinic slot publishing by voice and form | Working |
| SMS offers and replies | Working with Twilio (trial: verified numbers only); `SMS_MODE=simulated` shows texts in `/sms` instead |
| Distances | Working, straight-line miles from saved coordinates or town centers |
| Clinic verification, two-factor sign-in, HIPAA hosting | Planned, not built |
| Phone-call voice line, day-based booking | Planned, not built |

All data used during the hackathon is synthetic. No real patient information was used.

## Try it (for judges)

1. Open the live demo: [[TurnoListo](https://turnolisto-ebon.vercel.app/)]
2. **As a clinic:** register at `/registro-oficina` (any username), then publish slots on `/oficina`.
3. **As a patient:** sign in on `/` with any new username, fill in the profile with a fake name and phone, then tap the mic on `/nueva`.
4. Voice works best in Chrome. Allow microphone access.

## Credits

Built during the hackathon (October 8–10, 2026). Pre-existing components used:
- SvelteKit, Svelte, Tailwind CSS, and the official `sv` project scaffold
- Google Gemini Live API (voice), Twilio (SMS), Turso / libSQL (database), Vercel (hosting)
- Google Fonts: Bricolage Grotesque and Figtree
- AI coding assistants (Claude, Cline) were used to help write code and documentation


## Tech

SvelteKit 3 + Svelte 5 (runes), TypeScript, Tailwind CSS v4, `@sveltejs/adapter-vercel`, Gemini Live API, Twilio SMS, Turso (libSQL).

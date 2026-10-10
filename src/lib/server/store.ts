// Tiny document database: one JSON document, kept in Turso (libSQL) when TURSO_DATABASE_URL
// is set (required on Vercel), otherwise in data/turnolisto.json. It starts EMPTY: every
// user, clinic, request and slot is real data created through the app.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';

export type Clinic = {
	id: string;
	name: string;
	specialty: string;
	region: string;
	town: string;
	address: string;
	acceptedPlans: string[];
	/** Exact office coordinates. When missing, the town center is used for distances. */
	lat?: number | null;
	lng?: number | null;
};

export type UserRole = 'patient' | 'clinic';

/** Accounts are username-only (no password). A clinic user is tied to exactly one clinic. */
export type User = {
	id: string;
	/** Lowercase, unique across patients and clinics. */
	username: string;
	role: UserRole;
	clinicId: string | null;
	/** Patient contact details, remembered from their last request to prefill the form. */
	name: string;
	phone: string;
	/** Patient preference: send alerts by SMS. When false, offers are only shown in the app. */
	smsAlerts: boolean;
	/** Patient's current location, used to rank openings by distance. */
	lat: number | null;
	lng: number | null;
	createdAt: string;
};

export type Session = {
	token: string;
	userId: string;
	createdAt: string;
};

export type RequestStatus = 'waiting' | 'offered' | 'booked' | 'cancelled';

export type PatientRequest = {
	id: string;
	code: string;
	/** The patient account that owns this request. */
	userId: string;
	specialty: string;
	region: string;
	town: string;
	plan: string;
	preferredDays: string;
	hasReferral: boolean;
	/** Private: only revealed to a clinic after the patient accepts a slot. */
	patientName: string;
	/** Private: 10 digits, e.g. 7875550101. */
	patientPhone: string;
	status: RequestStatus;
	/** Shown to the patient, e.g. when a clinic cancelled their appointment. */
	notice?: string;
	createdAt: string;
};

export type SlotStatus = 'open' | 'offered' | 'booked';

export type Slot = {
	id: string;
	clinicId: string;
	startsAt: string;
	durationMin: number;
	acceptedPlans: string[];
	status: SlotStatus;
	requestId: string | null;
};

export type Offer = {
	id: string;
	slotId: string;
	requestId: string;
	sentAt: string;
	expiresAt: string;
	response: 'pending' | 'yes' | 'no' | 'expired';
};

export type SmsMessage = {
	id: string;
	direction: 'in' | 'out';
	phone: string;
	body: string;
	createdAt: string;
	/** How the AI interpreted an inbound reply (shown in the simulator). */
	aiNote?: string;
};

export type DB = {
	users: User[];
	sessions: Session[];
	clinics: Clinic[];
	requests: PatientRequest[];
	slots: Slot[];
	offers: Offer[];
	sms: SmsMessage[];
	counter: number;
};

const FILE = path.resolve('data', 'turnolisto.json');

const g = globalThis as unknown as {
__turnolistoDb?: DB;
__turnolistoTurso?: Client;
__turnolistoPending?: Promise<unknown>;
};

function empty(): DB {
return { users: [], sessions: [], clinics: [], requests: [], slots: [], offers: [], sms: [], counter: 0 };
}

/** Turso (libSQL) is used when TURSO_DATABASE_URL is set; otherwise the local JSON file. */
function turso(): Client | null {
const url = (process.env.TURSO_DATABASE_URL ?? '').trim();
if (!url) return null;
return (g.__turnolistoTurso ??= createClient({
url,
authToken: (process.env.TURSO_AUTH_TOKEN ?? '').trim() || undefined
}));
}

function normalize(raw: Partial<DB>): DB {
// Merge over defaults so data written by older versions still loads.
const d = { ...empty(), ...raw };
for (const u of d.users) {
u.smsAlerts ??= true;
u.lat ??= null;
u.lng ??= null;
}
return d;
}

/**
 * Load the database. With Turso this re-reads the data every call (serverless instances
 * do not share memory), so call it once at the start of each request. Locally it only
 * reads the file the first time.
 */
export async function loadDb(): Promise<void> {
const client = turso();
if (client) {
await client.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const res = await client.execute({ sql: 'SELECT value FROM kv WHERE key = ?', args: ['db'] });
const row = res.rows[0];
g.__turnolistoDb = row ? normalize(JSON.parse(String(row.value)) as Partial<DB>) : empty();
return;
}
if (g.__turnolistoDb) return;
if (fs.existsSync(FILE)) {
g.__turnolistoDb = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<DB>);
} else {
g.__turnolistoDb = empty();
save();
}
}

export function db(): DB {
if (!g.__turnolistoDb) {
if (turso()) throw new Error('Database not loaded: await loadDb() first');
g.__turnolistoDb = empty();
}
return g.__turnolistoDb;
}

/** Persist the database. With Turso the write is queued; await flush() before responding. */
export function save() {
const client = turso();
const json = JSON.stringify(g.__turnolistoDb);
if (client) {
const write = client.execute({
sql: 'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
args: ['db', json]
});
const prev = g.__turnolistoPending ?? Promise.resolve();
// Chain so writes land in order; keep failures visible to flush().
g.__turnolistoPending = prev.then(() => write);
g.__turnolistoPending.catch(() => {});
return;
}
// Local file: write to a temp file and rename, so a crash never leaves a half-written database.
fs.mkdirSync(path.dirname(FILE), { recursive: true });
const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(g.__turnolistoDb, null, 2));
fs.renameSync(tmp, FILE);
}

/** Wait for all pending Turso writes. Call before a serverless response finishes. */
export async function flush(): Promise<void> {
const p = g.__turnolistoPending;
g.__turnolistoPending = undefined;
if (p) await p;
}

export const uid = () => randomUUID();

export function nextCode(): string {
	const d = db();
	d.counter += 1;
	return 'TL-' + String(d.counter).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

/** Lowercase and trim. Returns null unless it is 3–24 chars of a-z, 0-9, dot, dash, underscore. */
export function cleanUsername(raw: string): string | null {
	const u = raw.trim().toLowerCase();
	return /^[a-z0-9._-]{3,24}$/.test(u) ? u : null;
}

export function findUser(username: string): User | undefined {
	return db().users.find((u) => u.username === username);
}

export function createUser(username: string, role: UserRole, clinicId: string | null = null): User {
	const user: User = {
		id: uid(),
		username,
		role,
		clinicId,
		name: '',
		phone: '',
		smsAlerts: true,
		lat: null,
		lng: null,
		createdAt: new Date().toISOString()
	};
	db().users.push(user);
	save();
	return user;
}

export function createSession(userId: string): string {
	const token = randomBytes(32).toString('hex');
	db().sessions.push({ token, userId, createdAt: new Date().toISOString() });
	save();
	return token;
}

export function destroySession(token: string) {
	const d = db();
	d.sessions = d.sessions.filter((s) => s.token !== token);
	save();
}

export function userForSession(token: string | undefined): User | null {
	if (!token) return null;
	const d = db();
	const s = d.sessions.find((x) => x.token === token);
	return (s && d.users.find((u) => u.id === s.userId)) || null;
}

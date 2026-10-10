// The three AI jobs in TurnoListo:
//   1. parseIntake        – patient's natural speech → anonymous request fields
//   2. parseSmsReply      – free-text SMS reply → yes / no / other time / unclear
//   3. parseClinicCommand – "Abre tres turnos el martes de 2 a 4" → slot times
//
// Each one runs fast rule-based parsing first (works with no API key) and, if an
// LLM key is configured, lets the model improve the result. Model output is
// always validated against fixed lists before it is used.
//
// Privacy rules enforced here:
//   - Diagnoses / symptoms are never stored: only specialty, area, plan, days, referral.
//   - The patient's name and phone are NOT sent to the AI; they are typed into a
//     separate form after the AI part is finished.
//   - The AI never decides urgency or which specialist someone needs. Emergencies
//     are redirected to 911 / Línea PAS.

import {
	PLANS,
	REGIONS,
	SPECIALTIES,
	TOWN_LABEL,
	TOWN_REGION,
	normalize
} from '../constants.ts';
import { llmJson } from './llm.ts';

// ---------------------------------------------------------------------------
// 1. Intake
// ---------------------------------------------------------------------------

export type IntakeFields = {
	specialty?: string;
	town?: string;
	region?: string;
	plan?: string;
	preferredDays?: string;
	hasReferral?: boolean;
};

export type IntakeKey = 'specialty' | 'region' | 'plan' | 'preferredDays' | 'hasReferral';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

export type IntakeResult = {
	fields: IntakeFields;
	missing: IntakeKey[];
	nextAsk: IntakeKey | null;
	reply: string;
	emergency: boolean;
	done: boolean;
};

const QUESTIONS: Record<IntakeKey, string> = {
	specialty: '¿Qué tipo de especialista necesitas? Por ejemplo: ortodoncista, neurólogo o cardiólogo.',
	region: '¿En qué pueblo o área de la isla te queda mejor la cita?',
	plan: '¿Qué plan médico tienes?',
	preferredDays: '¿Qué días te funcionan mejor para la cita?',
	hasReferral: '¿Ya tienes el referido de tu médico primario?'
};

const EMERGENCY_REPLY =
	'Si es una emergencia, llama al 911 ahora mismo. Si estás pasando por una crisis emocional, llama a la Línea PAS al 1-800-981-0023 o al 988. TurnoListo solo ayuda a conseguir citas, no atiende emergencias.';

const EMERGENCY_RE =
	/dolor (fuerte )?(de|en el) pecho|no puedo respirar|chest pain|can'?t breathe|suicid|quitarme la vida|me quiero morir|hacerme dano|emergencia|emergency|sangrando mucho|desmay|derrame|stroke|sobredosis|overdose/;

const SPECIALTY_RULES: [RegExp, string][] = [
	[/ortodon|orthodon|braces|frenillos/, 'Ortodoncia'],
	[/neurolog/, 'Neurología'],
	[/cardiolog/, 'Cardiología'],
	[/dermatolog/, 'Dermatología'],
	[/endocrinolog/, 'Endocrinología'],
	[/gastroenterolog|\bgastro\b/, 'Gastroenterología'],
	[/ortoped|orthoped/, 'Ortopedia'],
	[/psiquiatr|psychiatr/, 'Psiquiatría']
];

const PLAN_RULES: [RegExp, string][] = [
	[/triple ?-?s\b|\btriples\b/, 'Triple-S'],
	[/\bmcs\b/, 'MCS'],
	[/plan vital|\bvital\b|\breforma\b|plan del gobierno/, 'Plan Vital'],
	[/first medical/, 'First Medical'],
	[/medicare|advantage/, 'Medicare Advantage']
];

const WEEKDAYS: [RegExp, string][] = [
	[/\blunes\b|\bmonday/, 'Lunes'],
	[/\bmartes\b|\btuesday/, 'Martes'],
	[/\bmiercoles\b|\bwednesday/, 'Miércoles'],
	[/\bjueves\b|\bthursday/, 'Jueves'],
	[/\bviernes\b|\bfriday/, 'Viernes'],
	[/\bsabado\b|\bsaturday/, 'Sábado']
];

const YES_RE = /^\s*(s[ií]|si|yes|yeah|claro|correcto|afirmativo|ok|dale)\b/;
const NO_RE = /^\s*(no|nope|todavia no|aun no|not yet)\b/;

function rulesExtract(text: string, lastAsked?: string | null): IntakeFields {
	const t = normalize(text);
	const out: IntakeFields = {};

	for (const [re, s] of SPECIALTY_RULES) if (re.test(t)) { out.specialty = s; break; }

	for (const key of Object.keys(TOWN_REGION)) {
		if (new RegExp(`\\b${key}\\b`).test(t)) {
			out.town = TOWN_LABEL[key];
			out.region = TOWN_REGION[key];
			break;
		}
	}
	if (!out.region) {
		const m = t.match(/(area|zona|region|area del?)\s+(del?\s+|de la\s+)?(norte|sur|este|oeste|centro|metro)/);
		if (m) out.region = m[3][0].toUpperCase() + m[3].slice(1);
		else if (/metropolitana|\bmetro\b/.test(t)) out.region = 'Metro';
	}

	for (const [re, p] of PLAN_RULES) if (re.test(t)) { out.plan = p; break; }

	const days: string[] = [];
	for (const [re, d] of WEEKDAYS) if (re.test(t)) days.push(d);
	let when = '';
	if (/(por|en) la manana|\bmananas\b|morning/.test(t)) when = 'mañanas';
	if (/(por|en) la tarde|\btardes\b|afternoon/.test(t)) when = when ? 'cualquier hora' : 'tardes';
	if (days.length) out.preferredDays = days.join(', ') + (when ? `, ${when}` : '');
	else if (/cualquier (dia|momento)|no importa|any ?day|whenever|cuando sea/.test(t))
		out.preferredDays = 'Cualquier día' + (when ? `, ${when}` : '');
	else if (/entre semana|weekdays/.test(t)) out.preferredDays = 'Entre semana' + (when ? `, ${when}` : '');
	else if (when) out.preferredDays = when[0].toUpperCase() + when.slice(1);

	if (/no tengo (el |un )?referido|sin referido|no referral|don'?t have (a |the )?referral/.test(t))
		out.hasReferral = false;
	else if (/(tengo|traigo|ya tengo)( el| un)? referido|have (a |the )?referral|con referido/.test(t))
		out.hasReferral = true;
	else if (lastAsked === 'hasReferral') {
		if (NO_RE.test(t)) out.hasReferral = false;
		else if (YES_RE.test(t)) out.hasReferral = true;
	}
	return out;
}

const INTAKE_SYSTEM = `You extract appointment-request fields for TurnoListo, a service in Puerto Rico that matches patients with open specialist appointment slots.
Return ONLY a JSON object with these keys (use null when unknown):
{"specialty": one of ${JSON.stringify(SPECIALTIES)} or null,
 "town": a Puerto Rico town name or null,
 "region": one of ${JSON.stringify(REGIONS)} or null,
 "plan": one of ${JSON.stringify(PLANS)} or null (Reforma / plan del gobierno = "Plan Vital"),
 "preferred_days": short Spanish text like "Martes o jueves, tardes" or "Cualquier día", or null,
 "has_referral": true, false or null,
 "emergency": true only if the person describes a medical or mental-health emergency}
Rules:
- NEVER include diagnoses, symptoms, medications or any medical detail in any field.
- Only set "specialty" if the person names a type of specialist, including abbreviations, slang, plurals and typos (e.g. "neuro" or "neurólogo" = "Neurología", "cardio" = "Cardiología", "derma" = "Dermatología", "orto" with braces/dientes = "Ortodoncia", "psiquiatra" = "Psiquiatría"). Do not infer a specialty from symptoms.
- Be tolerant of typos and missing accents (e.g. "necsito neuro en san juan" means a neurologist in San Juan). A town in "town" also gives its "region".
- Always map to the exact option from the lists above, never invent new values.
- Do not give medical advice. Do not judge urgency.
- The conversation may be in Spanish or English.`;

type LlmIntake = {
	specialty?: string | null;
	town?: string | null;
	region?: string | null;
	plan?: string | null;
	preferred_days?: string | null;
	has_referral?: boolean | null;
	emergency?: boolean;
};

function pick<T extends readonly string[]>(list: T, v: unknown): T[number] | undefined {
	if (typeof v !== 'string') return undefined;
	const n = normalize(v);
	return list.find((x) => normalize(x) === n);
}

function sanitizeLlm(o: LlmIntake | null): IntakeFields {
	if (!o) return {};
	const out: IntakeFields = {};
	const s = pick(SPECIALTIES, o.specialty);
	if (s) out.specialty = s;
	const p = pick(PLANS, o.plan);
	if (p) out.plan = p;
	if (typeof o.town === 'string') {
		const key = normalize(o.town);
		if (TOWN_REGION[key]) {
			out.town = TOWN_LABEL[key];
			out.region = TOWN_REGION[key];
		}
	}
	if (!out.region) {
		const r = pick(REGIONS, o.region);
		if (r) out.region = r;
	}
	if (typeof o.preferred_days === 'string' && o.preferred_days.trim())
		out.preferredDays = o.preferred_days.trim().slice(0, 60);
	if (typeof o.has_referral === 'boolean') out.hasReferral = o.has_referral;
	return out;
}

function defined<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

export function missingFields(f: IntakeFields): IntakeKey[] {
	const m: IntakeKey[] = [];
	if (!f.specialty) m.push('specialty');
	if (!f.region) m.push('region');
	if (!f.plan) m.push('plan');
	if (!f.preferredDays) m.push('preferredDays');
	if (f.hasReferral === undefined) m.push('hasReferral');
	return m;
}

export async function parseIntake(
	messages: ChatMessage[],
	prev: IntakeFields,
	lastAsked?: string | null
): Promise<IntakeResult> {
	const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';

	if (EMERGENCY_RE.test(normalize(lastUser))) {
		const missing = missingFields(prev);
		return { fields: prev, missing, nextAsk: missing[0] ?? null, reply: EMERGENCY_REPLY, emergency: true, done: false };
	}

	const fromRules = rulesExtract(lastUser, lastAsked);

	const transcript = messages
		.slice(-12)
		.map((m) => `${m.role === 'user' ? 'Paciente' : 'Asistente'}: ${m.text}`)
		.join('\n');
	const llm = await llmJson<LlmIntake>(
		INTAKE_SYSTEM,
		`Fields already known: ${JSON.stringify(prev)}\nLast question asked: ${lastAsked ?? 'none'}\n\nConversation:\n${transcript}`
	);
	if (llm?.emergency) {
		const missing = missingFields(prev);
		return { fields: prev, missing, nextAsk: missing[0] ?? null, reply: EMERGENCY_REPLY, emergency: true, done: false };
	}

	const fields: IntakeFields = { ...prev, ...defined(fromRules), ...defined(sanitizeLlm(llm)) };
	if (fields.town && !fields.region) fields.region = TOWN_REGION[normalize(fields.town)];

	const gotSomething = JSON.stringify(fields) !== JSON.stringify(prev);
	const missing = missingFields(fields);
	const nextAsk = missing[0] ?? null;
	const done = missing.length === 0;

	let reply: string;
	if (done) {
		reply =
			'¡Perfecto, ya tengo todo! Ahora escribe tu nombre y tu teléfono para avisarte por SMS. La oficina no los verá hasta que aceptes un turno.';
	} else if (gotSomething) {
		reply = `Entendido. ${QUESTIONS[nextAsk!]}`;
	} else if (lastAsked) {
		reply = `Perdona, no te entendí bien. ${QUESTIONS[nextAsk!]}`;
	} else {
		reply = QUESTIONS[nextAsk!];
	}

	return { fields, missing, nextAsk, reply, emergency: false, done };
}

// ---------------------------------------------------------------------------
// 2. SMS replies
// ---------------------------------------------------------------------------

export type SmsIntent = 'yes' | 'no' | 'other_time' | 'unclear';

export const INTENT_NOTE: Record<SmsIntent, string> = {
	yes: 'acepta el turno',
	no: 'rechaza el turno',
	other_time: 'acepta, pero quiere otra hora',
	unclear: 'no está claro'
};

function rulesSmsIntent(text: string): SmsIntent {
	const t = normalize(text);
	const wantsOther =
		/mas tarde|mas temprano|otra hora|otro horario|otro dia|later|earlier|another time|different time/.test(t) ||
		(/\bpero\b|\bbut\b/.test(t) && /no puedo|can'?t/.test(t));
	if (wantsOther) return 'other_time';
	if (/^\s*(s[ií]|si|yes|ok|okay|dale|claro|acepto|confirmo|lo quiero|reservalo)\b/.test(t)) return 'yes';
	if (/^\s*(no|nope|paso|no gracias|cancel)\b/.test(t)) return 'no';
	return 'unclear';
}

export async function parseSmsReply(text: string, offerSummary: string): Promise<SmsIntent> {
	const rule = rulesSmsIntent(text);
	if (rule === 'yes' || rule === 'no') return rule; // simple replies don't need the model
	const llm = await llmJson<{ intent?: string }>(
		`A patient in Puerto Rico got an SMS offering a medical appointment slot and replied. Classify the reply.
Return ONLY JSON: {"intent": "yes" | "no" | "other_time" | "unclear"}
- "yes": accepts this slot.
- "no": declines this slot.
- "other_time": wants the appointment but at a different time or day.
- "unclear": anything else.`,
		`Offer: ${offerSummary}\nReply: ${text}`
	);
	const i = llm?.intent;
	if (i === 'yes' || i === 'no' || i === 'other_time' || i === 'unclear') return i;
	return rule;
}

// ---------------------------------------------------------------------------
// 3. Clinic voice commands
// ---------------------------------------------------------------------------

export type ClinicCommand = { startsAt: string[]; durationMin: number; summary: string };

const NUMBER_WORDS: Record<string, number> = {
	un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const DAY_INDEX: [RegExp, number][] = [
	[/\bdomingo\b|\bsunday\b/, 0],
	[/\blunes\b|\bmonday\b/, 1],
	[/\bmartes\b|\btuesday\b/, 2],
	[/\bmiercoles\b|\bwednesday\b/, 3],
	[/\bjueves\b|\bthursday\b/, 4],
	[/\bviernes\b|\bfriday\b/, 5],
	[/\bsabado\b|\bsaturday\b/, 6]
];

function to24(h: number, marker: string | undefined, isStart: boolean): number {
	const m = (marker ?? '').replace(/\./g, '');
	if (/pm|tarde|noche/.test(m) && h < 12) return h + 12;
	if (/am|manana/.test(m)) return h === 12 ? 0 : h;
	// No marker: clinic hours, so 1–7 means afternoon.
	if (h >= 1 && h <= 7) return h + 12;
	return isStart ? h : h;
}

function buildSlots(
	day: Date,
	startMin: number,
	endMin: number | null,
	count: number | null,
	duration: number | null
): ClinicCommand | null {
	let dur = duration ?? null;
	let n = count ?? null;
	if (endMin !== null && endMin > startMin) {
		const range = endMin - startMin;
		if (n && !dur) dur = Math.floor(range / n);
		if (!n) {
			dur = dur ?? 40;
			n = Math.floor(range / dur);
		}
	}
	dur = dur ?? 40;
	n = Math.max(1, Math.min(12, n ?? 1));
	const starts: string[] = [];
	for (let i = 0; i < n; i++) {
		const d = new Date(day);
		d.setHours(0, startMin + i * dur, 0, 0);
		starts.push(d.toISOString());
	}
	const label = day.toLocaleDateString('es-PR', { weekday: 'long', day: 'numeric', month: 'short' });
	return { startsAt: starts, durationMin: dur, summary: `${n} turno${n > 1 ? 's' : ''} de ${dur} min el ${label}` };
}

function rulesClinicCommand(text: string, now: Date): ClinicCommand | null {
	const t = normalize(text);

	let count: number | null = null;
	const cm = t.match(/(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)\s+(turnos?|citas?|espacios?|slots?|appointments?)/);
	if (cm) count = /^\d+$/.test(cm[1]) ? parseInt(cm[1], 10) : NUMBER_WORDS[cm[1]];

	const day = new Date(now);
	day.setHours(0, 0, 0, 0);
	if (/\bhoy\b|\btoday\b/.test(t)) {
		// today
	} else if (/pasado manana/.test(t)) {
		day.setDate(day.getDate() + 2);
	} else if (/(?<!la )\bmanana\b|\btomorrow\b/.test(t)) {
		day.setDate(day.getDate() + 1);
	} else {
		const found = DAY_INDEX.find(([re]) => re.test(t));
		if (found) {
			const diff = (found[1] - day.getDay() + 7) % 7 || 7;
			day.setDate(day.getDate() + diff);
		} else {
			day.setDate(day.getDate() + 1); // default: tomorrow
		}
	}

	const marker = '(am|pm|a\\.?m\\.?|p\\.?m\\.?|de la manana|de la tarde|de la noche)?';
	const range = t.match(
		new RegExp(`(?:de|desde|from|entre)\\s+(?:las\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${marker}\\s*(?:a|hasta|to|y|-)\\s+(?:las\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${marker}`)
	);
	const durM = t.match(/(\d+)\s*min/);
	const duration = durM ? parseInt(durM[1], 10) : null;

	if (range) {
		const sh = to24(parseInt(range[1], 10), range[3] ?? range[6], true);
		let eh = to24(parseInt(range[4], 10), range[6] ?? range[3], false);
		const start = sh * 60 + (range[2] ? parseInt(range[2], 10) : 0);
		let end = eh * 60 + (range[5] ? parseInt(range[5], 10) : 0);
		if (end <= start && end + 720 > start) {
			eh += 12;
			end += 720;
		}
		return buildSlots(day, start, end, count, duration);
	}

	const single = t.match(new RegExp(`a las\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${marker}`)) ?? t.match(new RegExp(`at\\s+(\\d{1,2})(?::(\\d{2}))?\\s*${marker}`));
	if (single) {
		const h = to24(parseInt(single[1], 10), single[3], true);
		return buildSlots(day, h * 60 + (single[2] ? parseInt(single[2], 10) : 0), null, count, duration);
	}
	return null;
}

export async function parseClinicCommand(text: string, now = new Date()): Promise<ClinicCommand | null> {
	const pad = (n: number) => String(n).padStart(2, '0');
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const weekday = now.toLocaleDateString('es-PR', { weekday: 'long' });

	const llm = await llmJson<{ date?: string; start?: string; end?: string | null; count?: number | null; duration_min?: number | null }>(
		`A clinic clerk in Puerto Rico is opening appointment slots by voice. Today is ${weekday} ${today}.
Return ONLY JSON: {"date": "YYYY-MM-DD", "start": "HH:MM" (24h), "end": "HH:MM" or null, "count": number or null, "duration_min": number or null}
If the clerk says a weekday, use the next upcoming one. Times without am/pm between 1 and 7 are afternoon.`,
		text
	);
	const res = llm ? slotsFromParts(llm) : null;
	if (res) return res;
	return rulesClinicCommand(text, now);
}

// ---------------------------------------------------------------------------
// 4. Live voice assistant (Gemini Live function calls)
// ---------------------------------------------------------------------------

export type LiveIntakeResult = {
fields: IntakeFields;
missing: IntakeKey[];
nextAsk: IntakeKey | null;
done: boolean;
ignored: string[];
emergency: boolean;
question: string | null;
};

/**
 * Applies the arguments of the live model's `update_request` call to the fields
 * already collected. Same sanitising as the text intake: values must match the
 * known lists, and nothing medical is ever stored.
 */
export function mergeLiveIntake(prev: IntakeFields, args: Record<string, unknown>): LiveIntakeResult {
const a = args as LlmIntake;
if (a.emergency === true) {
const missing = missingFields(prev);
return { fields: prev, missing, nextAsk: missing[0] ?? null, done: false, ignored: [], emergency: true, question: null };
}
const sanitized = sanitizeLlm(a);
// Tolerate small spelling differences ("Triple S") with the same rules used for typed text.
const spoken = [a.specialty, a.town, a.region, a.plan, a.preferred_days]
.filter((v): v is string => typeof v === 'string')
.join(' ');
const fromRules = spoken ? rulesExtract(spoken) : {};
const fields: IntakeFields = { ...prev, ...defined(fromRules), ...defined(sanitized) };
if (fields.town && !fields.region) fields.region = TOWN_REGION[normalize(fields.town)];
if (typeof a.has_referral === 'boolean') fields.hasReferral = a.has_referral;

const ignored: string[] = [];
if (a.specialty && !fields.specialty) ignored.push('specialty');
if ((a.town || a.region) && !fields.region) ignored.push('town/region');
if (a.plan && !fields.plan) ignored.push('plan');

const missing = missingFields(fields);
const nextAsk = missing[0] ?? null;
return { fields, missing, nextAsk, done: missing.length === 0, ignored, emergency: false, question: nextAsk ? QUESTIONS[nextAsk] : null };
}

export const LIVE_EMERGENCY_REPLY = EMERGENCY_REPLY;

export type ClinicParts = {
date?: unknown;
start?: unknown;
end?: unknown;
count?: unknown;
duration_min?: unknown;
};

/** Builds slot times from already-structured parts (LLM JSON or a live function call). */
export function slotsFromParts(p: ClinicParts): ClinicCommand | null {
if (typeof p.date !== 'string' || typeof p.start !== 'string') return null;
if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !/^\d{1,2}:\d{2}$/.test(p.start)) return null;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
const [y, m, d] = p.date.split('-').map(Number);
const day = new Date(y, m - 1, d);
const [sh, sm] = p.start.split(':').map(Number);
let end: number | null = null;
if (typeof p.end === 'string' && /^\d{1,2}:\d{2}$/.test(p.end)) {
const [eh, em] = p.end.split(':').map(Number);
end = eh * 60 + em;
}
return buildSlots(day, sh * 60 + sm, end, num(p.count), num(p.duration_min));
}

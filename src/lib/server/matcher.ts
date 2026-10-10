// Matching rules:
//  - Right away: when a patient asks, findOpenings() returns up to 3 open slots they can
//    pick from (same specialty, a plan the slot accepts, same region or within NEARBY_MILES,
//    closest first). The patient chooses one and bookOpening() books it.
//  - Later: if nothing is open, the request waits. When a slot opens, it can go to a request
//    with the same specialty, a plan the slot accepts, in the same region or nearby.
//  - Among eligible waiting requests, the one that has waited longest gets the offer. The
//    alert goes by SMS unless the patient turned SMS alerts off (then it shows in the app).
//  - Clinics never browse or choose patients.
//  - Patient name/phone are revealed to the clinic only once the slot is booked.
import { OFFER_MINUTES, formatSlot, prDayKey } from '../constants.ts';
import { formatMiles } from '../geo.ts';
import type { OpeningCard } from '../types.ts';
import { INTENT_NOTE, parseSmsReply } from './ai.ts';
import { closeEnough, milesToClinic } from './places.ts';
import { logInbound, notifyPatient, phoneDigits, sendSms } from './sms.ts';
import { db, nextCode, save, uid, type Clinic, type Offer, type PatientRequest, type Slot } from './store.ts';

function clinicOf(slot: Slot): Clinic | undefined {
	return db().clinics.find((c) => c.id === slot.clinicId);
}

function alreadyTried(slotId: string, requestId: string) {
	return db().offers.some((o) => o.slotId === slotId && o.requestId === requestId && o.response !== 'pending');
}

export function eligibleRequests(slot: Slot): PatientRequest[] {
	const clinic = clinicOf(slot);
	if (!clinic) return [];
	return db()
		.requests.filter(
			(r) =>
				r.status === 'waiting' &&
				r.specialty === clinic.specialty &&
				closeEnough(r.region, clinic, milesToClinic(r.userId, r.town, clinic)) &&
				slot.acceptedPlans.includes(r.plan) &&
				!alreadyTried(slot.id, r.id)
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function offerText(slot: Slot, clinic: Clinic, miles: number | null = null) {
	const full = formatSlot(slot.startsAt).full.replace(/\.$/, '');
	const away = miles === null ? '' : ` (a ${formatMiles(miles)})`;
	return `TurnoListo: Turno disponible - ${clinic.specialty}, ${clinic.town}${away}. ${full}. Acepta tu plan. Responde SI en ${OFFER_MINUTES} min para reservarlo o NO para pasar.`;
}

/** Offer one open slot to the longest-waiting eligible request. */
export async function matchSlot(slotId: string): Promise<boolean> {
	const d = db();
	const slot = d.slots.find((s) => s.id === slotId);
	if (!slot || slot.status !== 'open' || new Date(slot.startsAt).getTime() < Date.now()) return false;
	const clinic = clinicOf(slot);
	const req = eligibleRequests(slot)[0];
	if (!clinic || !req) return false;

	const now = new Date();
	d.offers.push({
		id: uid(),
		slotId: slot.id,
		requestId: req.id,
		sentAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + OFFER_MINUTES * 60_000).toISOString(),
		response: 'pending'
	});
	slot.status = 'offered';
	req.status = 'offered';
	save();
	await notifyPatient(req, offerText(slot, clinic, milesToClinic(req.userId, req.town, clinic)));
	return true;
}

/** Try every open slot (earliest first). Call after anything changes. */
export async function runMatching() {
	const open = db()
		.slots.filter((s) => s.status === 'open')
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
	for (const s of open) await matchSlot(s.id);
}

/** Marks the slot and request as booked and tells the patient. Used by SMS offers and direct picks. */
async function confirmBooking(slot: Slot, req: PatientRequest) {
	const clinic = clinicOf(slot)!;
	slot.status = 'booked';
	slot.requestId = req.id;
	req.status = 'booked';
	req.notice = undefined;
	save();
	const { full } = formatSlot(slot.startsAt);
	await notifyPatient(
		req,
		`TurnoListo: Listo! Tu cita es el ${full} en ${clinic.name}, ${clinic.address}. La oficina ya puede ver tu nombre y telefono.${req.hasReferral ? ' Lleva tu referido.' : ' Recuerda pedir el referido a tu medico primario.'}`
	);
}

async function book(offer: Offer) {
	const d = db();
	const slot = d.slots.find((s) => s.id === offer.slotId)!;
	const req = d.requests.find((r) => r.id === offer.requestId)!;
	offer.response = 'yes';
	await confirmBooking(slot, req);
}

/**
 * Up to `limit` open slots a patient can book right now: same specialty, a plan the slot
 * accepts, and in the patient's region or within NEARBY_MILES. Closest first, then soonest.
 */
export function findOpenings(
	userId: string,
	f: { specialty: string; region: string; plan: string; town?: string },
	limit = 3
): OpeningCard[] {
	const found: { slot: Slot; clinic: Clinic; miles: number | null }[] = [];
	for (const slot of db().slots) {
		if (slot.status !== 'open' || new Date(slot.startsAt).getTime() < Date.now()) continue;
		if (!slot.acceptedPlans.includes(f.plan)) continue;
		const clinic = clinicOf(slot);
		if (!clinic || clinic.specialty !== f.specialty) continue;
		const miles = milesToClinic(userId, f.town, clinic);
		if (!closeEnough(f.region, clinic, miles)) continue;
		found.push({ slot, clinic, miles });
	}
	found.sort((a, b) => {
		if (a.miles !== b.miles) return (a.miles ?? Infinity) - (b.miles ?? Infinity);
		return a.slot.startsAt.localeCompare(b.slot.startsAt);
	});
	return found.slice(0, limit).map(({ slot, clinic, miles }) => ({
		slotId: slot.id,
		clinic: clinic.name,
		town: clinic.town,
		address: clinic.address,
		startsAt: slot.startsAt,
		when: formatSlot(slot.startsAt).full,
		miles: miles === null ? null : Math.round(miles * 10) / 10,
		distance: formatMiles(miles)
	}));
}

/**
 * Books the opening the patient picked. Re-checks everything, because the slot may have been
 * taken since it was shown. Returns the new request code, or an error message.
 */
export async function bookOpening(
	userId: string,
	slotId: string,
	f: RequestFields,
	contact: { name: string; phone: string }
): Promise<{ ok: true; code: string } | { ok: false; reason: 'taken' | 'invalid' | 'duplicate'; message: string }> {
	const d = db();
	const slot = d.slots.find((s) => s.id === slotId);
	const clinic = slot && clinicOf(slot);
	if (!slot || !clinic || clinic.specialty !== f.specialty || !slot.acceptedPlans.includes(f.plan))
		return { ok: false, reason: 'invalid', message: 'Ese turno no es válido para tu solicitud.' };
	if (slot.status !== 'open' || new Date(slot.startsAt).getTime() < Date.now())
		return { ok: false, reason: 'taken', message: 'Ese turno ya no está disponible.' };
	const dup = activeRequest(userId, f.specialty);
	if (dup)
		return {
			ok: false,
			reason: 'duplicate',
			message: `Ya tienes una solicitud activa de ${f.specialty} (${dup.code}). Cancélala primero.`
		};

	const req = addRequest(userId, f, contact);
	await confirmBooking(slot, req);
	return { ok: true, code: req.code };
}

export type RequestFields = {
	specialty: string;
	region: string;
	town: string;
	plan: string;
	preferredDays: string;
	hasReferral: boolean;
};

/** The patient's active (waiting or offered) request for a specialty, if any. */
export function activeRequest(userId: string, specialty: string): PatientRequest | undefined {
	return db().requests.find(
		(r) => r.userId === userId && r.specialty === specialty && (r.status === 'waiting' || r.status === 'offered')
	);
}

/** Creates a waiting request (the patient joins the line). Does not check for duplicates. */
export function addRequest(userId: string, f: RequestFields, contact: { name: string; phone: string }): PatientRequest {
	const req: PatientRequest = {
		id: uid(),
		code: nextCode(),
		userId,
		specialty: f.specialty,
		region: f.region,
		town: f.town,
		plan: f.plan,
		preferredDays: f.preferredDays,
		hasReferral: f.hasReferral,
		patientName: contact.name,
		patientPhone: contact.phone,
		status: 'waiting',
		createdAt: new Date().toISOString()
	};
	db().requests.push(req);
	save();
	return req;
}

/** Joins the line when nothing is open now: the first matching slot that opens is offered. */
export async function joinWaitlist(
	userId: string,
	f: RequestFields,
	contact: { name: string; phone: string }
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
	const dup = activeRequest(userId, f.specialty);
	if (dup)
		return { ok: false, message: `Ya tienes una solicitud activa de ${f.specialty} (${dup.code}). Cancélala primero.` };
	const req = addRequest(userId, f, contact);
	await runMatching();
	return { ok: true, code: req.code };
}

/** Patient answers an offer from the app (for patients who turned SMS alerts off, or just prefer the web). */
export async function respondToOffer(code: string, userId: string, accept: boolean) {
	const d = db();
	const req = d.requests.find((r) => r.code === code && r.userId === userId && r.status === 'offered');
	const offer = req && pendingOfferFor(req.id);
	if (!req || !offer) return;
	if (accept) return book(offer);
	return release(offer, 'no');
}

/** Decline or expiry: request goes back to the line, slot goes to the next person. */
export async function release(offer: Offer, response: 'no' | 'expired') {
	const d = db();
	const slot = d.slots.find((s) => s.id === offer.slotId);
	const req = d.requests.find((r) => r.id === offer.requestId);
	offer.response = response;
	if (slot && slot.status === 'offered') slot.status = 'open';
	if (req && req.status === 'offered') req.status = 'waiting';
	save();
	if (req && response === 'expired') {
		await notifyPatient(req, 'TurnoListo: El turno ofrecido expiró. Sigues en la fila y te avisaremos del próximo.');
	}
	await runMatching();
}

export async function expireOffers(force = false) {
	const now = Date.now();
	const expired = db().offers.filter(
		(o) => o.response === 'pending' && (force || new Date(o.expiresAt).getTime() <= now)
	);
	for (const o of expired) await release(o, 'expired');
	return expired.length;
}

export function pendingOfferFor(requestId: string): Offer | undefined {
	return db().offers.find((o) => o.requestId === requestId && o.response === 'pending');
}

/** Entry point for every SMS a patient sends (Twilio webhook or the simulator). */
export async function handleInboundSms(phone: string, body: string) {
	const d = db();
	const digits = phoneDigits(phone);
	const req = d.requests
		.filter((r) => r.patientPhone === digits && r.status === 'offered')
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
	const offer = req ? pendingOfferFor(req.id) : undefined;

	if (!req || !offer) {
		logInbound(digits, body);
		await sendSms(digits, 'TurnoListo: No tienes ofertas pendientes ahora mismo. Te avisaremos cuando abra un turno.');
		return;
	}

	const slot = d.slots.find((s) => s.id === offer.slotId)!;
	const clinic = clinicOf(slot)!;
	const intent = await parseSmsReply(body, offerText(slot, clinic));
	logInbound(digits, body, INTENT_NOTE[intent]);

	if (intent === 'yes') return book(offer);

	if (intent === 'no') {
		await sendSms(digits, 'TurnoListo: Entendido. Sigues en la fila y te avisaremos del próximo turno.');
		return release(offer, 'no');
	}

	if (intent === 'other_time') {
		// Look for another open slot at the same clinic on the same day.
		const sameDay = prDayKey(slot.startsAt);
		const alt = d.slots
			.filter(
				(s) =>
					s.id !== slot.id &&
					s.clinicId === slot.clinicId &&
					s.status === 'open' &&
					prDayKey(s.startsAt) === sameDay &&
					s.acceptedPlans.includes(req.plan)
			)
			.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
			.find((s) => s.startsAt > slot.startsAt) ??
			d.slots.find(
				(s) =>
					s.id !== slot.id &&
					s.clinicId === slot.clinicId &&
					s.status === 'open' &&
					prDayKey(s.startsAt) === sameDay &&
					s.acceptedPlans.includes(req.plan)
			);

		if (alt) {
			// Move the offer to the alternative slot and free the original one.
			slot.status = 'open';
			alt.status = 'offered';
			offer.slotId = alt.id;
			offer.expiresAt = new Date(Date.now() + OFFER_MINUTES * 60_000).toISOString();
			save();
			await sendSms(
				digits,
				`TurnoListo: Hay un turno el mismo día a las ${formatSlot(alt.startsAt).time}. ¿Lo reservo? Responde SI o NO.`
			);
			await runMatching(); // original slot goes to the next person in line
			return;
		}
		await sendSms(
			digits,
			`TurnoListo: No hay otro turno ese día. Responde SI para tomar el de las ${formatSlot(slot.startsAt).time}, o NO para seguir esperando.`
		);
		return;
	}

	await sendSms(digits, 'TurnoListo: No te entendí. Responde SI para reservar el turno o NO para pasar.');
}

/**
 * Patient cancels from the web: a waiting request, a pending offer, or a booked appointment.
 * A cancelled appointment goes back to open and is offered to the next person in line.
 */
export async function cancelRequest(code: string, userId: string) {
	const d = db();
	const req = d.requests.find((r) => r.code === code && r.userId === userId);
	if (!req || req.status === 'cancelled') return;
	if (req.status === 'booked') {
		const booked = d.slots.find((s) => s.requestId === req.id && s.status === 'booked');
		// Past appointments are history, not cancellable.
		if (booked && new Date(booked.startsAt).getTime() < Date.now()) return;
		if (booked) {
			booked.status = 'open';
			booked.requestId = null;
		}
		req.status = 'cancelled';
		save();
		await runMatching();
		return;
	}
	const offer = pendingOfferFor(req.id);
	req.status = 'cancelled';
	if (offer) {
		offer.response = 'no';
		const slot = d.slots.find((s) => s.id === offer.slotId);
		if (slot) slot.status = 'open';
	}
	save();
	await runMatching();
}

/**
 * A clinic cancels one of its booked appointments. The slot is removed (the clinic can't do
 * it), and the patient goes back in line with their original place, with a notice and an alert.
 */
export async function clinicCancelBooking(clinicId: string, slotId: string): Promise<boolean> {
	const d = db();
	const i = d.slots.findIndex((s) => s.id === slotId && s.clinicId === clinicId && s.status === 'booked');
	if (i < 0) return false;
	const slot = d.slots[i];
	const req = d.requests.find((r) => r.id === slot.requestId);
	const clinic = clinicOf(slot);
	d.slots.splice(i, 1);
	if (req && req.status === 'booked' && clinic) {
		const full = formatSlot(slot.startsAt).full.replace(/\.$/, '');
		req.status = 'waiting';
		req.notice = `${clinic.name} canceló tu cita del ${full}. Sigues en la fila.`;
		save();
		await notifyPatient(
			req,
			`TurnoListo: ${clinic.name} canceló tu cita del ${full}. Sigues en la fila y te avisaremos del próximo turno.`
		);
	} else {
		save();
	}
	await runMatching();
	return true;
}

/** Patient removes a cancelled request from their list for good. Active requests must be cancelled first. */
export function removeRequest(code: string, userId: string): boolean {
	const d = db();
	const req = d.requests.find((r) => r.code === code && r.userId === userId);
	if (!req || req.status !== 'cancelled') return false;
	d.requests = d.requests.filter((r) => r.id !== req.id);
	d.offers = d.offers.filter((o) => o.requestId !== req.id);
	save();
	return true;
}

/** Position in line among requests that compete for the same slots. */
export function queuePosition(req: PatientRequest): number {
	return (
		db().requests.filter(
			(r) =>
				r.status === 'waiting' &&
				r.specialty === req.specialty &&
				r.region === req.region &&
				r.createdAt < req.createdAt
		).length + 1
	);
}

// Matching rules:
//  - A slot can go to a request with the same specialty and region, whose plan
//    the clinic accepts for that slot.
//  - Among eligible requests, the one that has waited longest gets the offer.
//  - Clinics never browse or choose patients.
//  - Patient name/phone are revealed to the clinic only once the slot is booked.
import { OFFER_MINUTES, formatSlot } from '../constants.ts';
import { INTENT_NOTE, parseSmsReply } from './ai.ts';
import { logInbound, phoneDigits, sendSms } from './sms.ts';
import { db, save, uid, type Clinic, type Offer, type PatientRequest, type Slot } from './store.ts';

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
				r.region === clinic.region &&
				slot.acceptedPlans.includes(r.plan) &&
				!alreadyTried(slot.id, r.id)
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function offerText(slot: Slot, clinic: Clinic) {
	const full = formatSlot(slot.startsAt).full.replace(/\.$/, '');
	return `TurnoListo: Turno disponible - ${clinic.specialty}, ${clinic.town}. ${full}. Acepta tu plan. Responde SI en ${OFFER_MINUTES} min para reservarlo o NO para pasar.`;
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
	await sendSms(req.patientPhone, offerText(slot, clinic));
	return true;
}

/** Try every open slot (earliest first). Call after anything changes. */
export async function runMatching() {
	const open = db()
		.slots.filter((s) => s.status === 'open')
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
	for (const s of open) await matchSlot(s.id);
}

async function book(offer: Offer) {
	const d = db();
	const slot = d.slots.find((s) => s.id === offer.slotId)!;
	const req = d.requests.find((r) => r.id === offer.requestId)!;
	const clinic = clinicOf(slot)!;
	offer.response = 'yes';
	slot.status = 'booked';
	slot.requestId = req.id;
	req.status = 'booked';
	save();
	const { full } = formatSlot(slot.startsAt);
	await sendSms(
		req.patientPhone,
		`TurnoListo: Listo! Tu cita es el ${full} en ${clinic.name}, ${clinic.address}. La oficina ya puede ver tu nombre y telefono.${req.hasReferral ? ' Lleva tu referido.' : ' Recuerda pedir el referido a tu medico primario.'}`
	);
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
		await sendSms(req.patientPhone, 'TurnoListo: El turno ofrecido expiró. Sigues en la fila y te avisaremos del próximo.');
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
		const sameDay = new Date(slot.startsAt).toDateString();
		const alt = d.slots
			.filter(
				(s) =>
					s.id !== slot.id &&
					s.clinicId === slot.clinicId &&
					s.status === 'open' &&
					new Date(s.startsAt).toDateString() === sameDay &&
					s.acceptedPlans.includes(req.plan)
			)
			.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
			.find((s) => s.startsAt > slot.startsAt) ??
			d.slots.find(
				(s) =>
					s.id !== slot.id &&
					s.clinicId === slot.clinicId &&
					s.status === 'open' &&
					new Date(s.startsAt).toDateString() === sameDay &&
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

/** Patient cancels from the web. */
export async function cancelRequest(code: string, userId: string) {
	const d = db();
	const req = d.requests.find((r) => r.code === code && r.userId === userId);
	if (!req || req.status === 'booked' || req.status === 'cancelled') return;
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

import { error } from '@sveltejs/kit';
import { cancelRequest, pendingOfferFor, queuePosition } from '#lib/server/matcher.ts';
import { db } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const d = db();
	// Only the owner can see a request; anyone else gets the same 404.
	const req = d.requests.find((r) => r.code === params.code && r.userId === locals.user?.id);
	if (!req) error(404, 'Solicitud no encontrada');

	let slot: { startsAt: string; clinic: string; address: string; expiresAt?: string } | null = null;
	if (req.status === 'offered') {
		const offer = pendingOfferFor(req.id);
		const s = offer && d.slots.find((x) => x.id === offer.slotId);
		const c = s && d.clinics.find((x) => x.id === s.clinicId);
		if (s && c) slot = { startsAt: s.startsAt, clinic: c.name, address: c.address, expiresAt: offer!.expiresAt };
	} else if (req.status === 'booked') {
		const s = d.slots.find((x) => x.requestId === req.id && x.status === 'booked');
		const c = s && d.clinics.find((x) => x.id === s.clinicId);
		if (s && c) slot = { startsAt: s.startsAt, clinic: c.name, address: c.address };
	}

	return {
		request: {
			code: req.code,
			specialty: req.specialty,
			region: req.region,
			town: req.town,
			plan: req.plan,
			preferredDays: req.preferredDays,
			hasReferral: req.hasReferral,
			status: req.status,
			phoneLast4: req.patientPhone.slice(-4)
		},
		position: req.status === 'waiting' ? queuePosition(req) : null,
		slot
	};
};

export const actions: Actions = {
	cancel: async ({ params, locals }) => {
		await cancelRequest(params.code, locals.user!.id);
	}
};

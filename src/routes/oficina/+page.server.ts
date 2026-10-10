import { error, fail } from '@sveltejs/kit';
import { PLANS } from '#lib/constants.ts';
import { parseClinicCommand } from '#lib/server/ai.ts';
import { llmEnabled } from '#lib/server/llm.ts';
import { runMatching } from '#lib/server/matcher.ts';
import { addSlots } from '#lib/server/slots.ts';
import { db, save, type Clinic } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** The clinic is always the one tied to the signed-in user; never taken from the request. */
function getClinic(user: App.Locals['user']): Clinic {
	const clinic = db().clinics.find((c) => c.id === user?.clinicId);
	if (!clinic) error(404, 'Oficina no encontrada');
	return clinic;
}

export const load: PageServerLoad = ({ locals }) => {
	const d = db();
	const clinic = getClinic(locals.user);
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);

	const slots = d.slots
		.filter((s) => s.clinicId === clinic.id && new Date(s.startsAt) >= startOfToday)
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
		.map((s) => {
			const req = s.requestId ? d.requests.find((r) => r.id === s.requestId) : undefined;
			const offer = d.offers.find((o) => o.slotId === s.id && o.response === 'pending');
			return {
				id: s.id,
				startsAt: s.startsAt,
				durationMin: s.durationMin,
				status: s.status,
				offerExpiresAt: offer?.expiresAt ?? null,
				// Patient identity ONLY after booking.
				patient:
					s.status === 'booked' && req
						? { name: req.patientName, phone: req.patientPhone, plan: req.plan, hasReferral: req.hasReferral }
						: null
			};
		});

	const sameNeed = d.requests.filter(
		(r) => r.status === 'waiting' && r.specialty === clinic.specialty && r.region === clinic.region
	);

	return {
		username: locals.user!.username,
		clinic,
		allPlans: [...PLANS],
		slots,
		stats: {
			open: slots.filter((s) => s.status === 'open').length,
			offered: slots.filter((s) => s.status === 'offered').length,
			booked: slots.filter((s) => s.status === 'booked').length
		},
		waitingMatching: sameNeed.filter((r) => clinic.acceptedPlans.includes(r.plan)).length,
		waitingOtherPlans: sameNeed.filter((r) => !clinic.acceptedPlans.includes(r.plan)).length,
		aiEnabled: llmEnabled()
	};
};

export const actions: Actions = {
	plans: async ({ request, locals }) => {
		const f = await request.formData();
		const clinic = getClinic(locals.user);
		const plans = f.getAll('plans').map(String).filter((p) => (PLANS as readonly string[]).includes(p));
		clinic.acceptedPlans = plans;
		for (const s of db().slots) if (s.clinicId === clinic.id && s.status === 'open') s.acceptedPlans = [...plans];
		save();
		await runMatching();
		return { message: 'Planes actualizados.' };
	},

	publish: async ({ request, locals }) => {
		const f = await request.formData();
		const clinic = getClinic(locals.user);
		const date = String(f.get('date') ?? '');
		const from = String(f.get('from') ?? '');
		const to = String(f.get('to') ?? '');
		const duration = Math.max(10, Math.min(120, parseInt(String(f.get('duration') ?? '40'), 10) || 40));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to))
			return fail(400, { message: 'Completa la fecha y las horas.' });

		const [y, m, d] = date.split('-').map(Number);
		const [fh, fm] = from.split(':').map(Number);
		const [th, tm] = to.split(':').map(Number);
		const startMin = fh * 60 + fm;
		const endMin = th * 60 + tm;
		if (endMin <= startMin) return fail(400, { message: 'La hora final debe ser después de la inicial.' });

		const starts: string[] = [];
		for (let t = startMin; t + duration <= endMin && starts.length < 24; t += duration) {
			starts.push(new Date(y, m - 1, d, 0, t).toISOString());
		}
		if (!starts.length) return fail(400, { message: 'El rango es más corto que un turno.' });
		addSlots(clinic, starts, duration);
		await runMatching();
		return { message: `Se publicaron ${starts.length} turno(s). TurnoListo ya está buscando pacientes.` };
	},

	voice: async ({ request, locals }) => {
		const f = await request.formData();
		const clinic = getClinic(locals.user);
		const text = String(f.get('text') ?? '').slice(0, 300);
		const cmd = await parseClinicCommand(text);
		if (!cmd) return fail(400, { message: 'No entendí. Prueba: "Abre tres turnos el martes de 2 a 4".', heard: text });
		addSlots(clinic, cmd.startsAt, cmd.durationMin);
		await runMatching();
		return { message: `Entendido: ${cmd.summary}. Ya está buscando pacientes.`, heard: text };
	},

	remove: async ({ request, locals }) => {
		const clinic = getClinic(locals.user);
		const f = await request.formData();
		const id = String(f.get('slot'));
		const d = db();
		const i = d.slots.findIndex((s) => s.id === id && s.clinicId === clinic.id && s.status === 'open');
		if (i >= 0) d.slots.splice(i, 1);
		save();
	}
};

import { fail, redirect } from '@sveltejs/kit';
import { PLANS, REGIONS, SPECIALTIES } from '#lib/constants.ts';
import { runMatching } from '#lib/server/matcher.ts';
import { db, nextCode, save, uid } from '#lib/server/store.ts';
import { phoneDigits } from '#lib/server/sms.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	// Remembered from the patient's last request, to prefill the contact form.
	saved: { name: locals.user?.name ?? '', phone: locals.user?.phone ?? '' }
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = locals.user;
		if (!user || user.role !== 'patient') redirect(303, '/');

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim().slice(0, 40);
		const phone = phoneDigits(String(data.get('phone') ?? ''));
		let fields: Record<string, unknown> = {};
		try {
			fields = JSON.parse(String(data.get('fields') ?? '{}'));
		} catch {
			/* handled below */
		}

		const specialty = SPECIALTIES.find((s) => s === fields.specialty);
		const region = REGIONS.find((r) => r === fields.region);
		const plan = PLANS.find((p) => p === fields.plan);
		const preferredDays = typeof fields.preferredDays === 'string' ? fields.preferredDays.slice(0, 60) : '';
		const hasReferral = fields.hasReferral === true;
		const town = typeof fields.town === 'string' ? fields.town.slice(0, 40) : '';

		if (!specialty || !region || !plan || !preferredDays)
			return fail(400, { message: 'Faltan datos de la solicitud. Empieza de nuevo, por favor.' });
		if (!name) return fail(400, { message: 'Escribe tu nombre.' });
		if (phone.length !== 10) return fail(400, { message: 'Escribe un teléfono de 10 dígitos, por ejemplo 787-555-0123.' });

		const d = db();
		const duplicate = d.requests.find(
			(r) =>
				r.userId === user.id &&
				r.specialty === specialty &&
				r.region === region &&
				(r.status === 'waiting' || r.status === 'offered')
		);
		if (duplicate)
			return fail(400, {
				message: `Ya tienes una solicitud activa de ${specialty} en ${region} (${duplicate.code}). Cancélala primero si quieres cambiarla.`
			});

		// Remember contact details for next time.
		const account = d.users.find((u) => u.id === user.id);
		if (account) {
			account.name = name;
			account.phone = phone;
		}

		const code = nextCode();
		d.requests.push({
			id: uid(),
			code,
			userId: user.id,
			specialty,
			region,
			town,
			plan,
			preferredDays,
			hasReferral,
			patientName: name,
			patientPhone: phone,
			status: 'waiting',
			createdAt: new Date().toISOString()
		});
		save();
		await runMatching();
		redirect(303, `/solicitud/${code}`);
	}
};

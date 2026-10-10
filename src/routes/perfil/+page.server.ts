import { fail } from '@sveltejs/kit';
import { parseCoordsForm } from '#lib/geo.ts';
import { phoneDigits } from '#lib/server/sms.ts';
import { db, save } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const u = locals.user!;
	return {
		username: u.username,
		profile: { name: u.name, phone: u.phone, smsAlerts: u.smsAlerts !== false, lat: u.lat, lng: u.lng },
		// Set when the patient was sent here to finish their profile before asking for a specialist.
		next: url.searchParams.get('next') === 'nueva'
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim().slice(0, 40);
		const phone = phoneDigits(String(f.get('phone') ?? ''));
		const smsAlerts = f.get('smsAlerts') === 'on';
		const values = { name, phone: String(f.get('phone') ?? ''), smsAlerts, lat: String(f.get('lat') ?? ''), lng: String(f.get('lng') ?? '') };

		if (!name) return fail(400, { ...values, message: 'Escribe tu nombre.' });
		// The phone is only required when alerts go by SMS, but booked appointments still need a way to reach the patient.
		if (phone.length !== 10)
			return fail(400, { ...values, message: 'Escribe un teléfono de 10 dígitos, por ejemplo 787-555-0123.' });
		const loc = parseCoordsForm(f.get('lat'), f.get('lng'));
		if ('error' in loc) return fail(400, { ...values, message: loc.error });

		const account = db().users.find((u) => u.id === locals.user!.id);
		if (!account) return fail(400, { ...values, message: 'No se encontró tu cuenta.' });
		account.name = name;
		account.phone = phone;
		account.smsAlerts = smsAlerts;
		account.lat = loc.coords?.lat ?? null;
		account.lng = loc.coords?.lng ?? null;
		save();
		return { saved: true, message: 'Perfil guardado.' };
	}
};

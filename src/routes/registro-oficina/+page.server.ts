import { fail, redirect } from '@sveltejs/kit';
import { PLANS, SPECIALTIES, TOWN_LABEL, TOWN_REGION } from '#lib/constants.ts';
import { homeFor, startSession } from '#lib/server/auth.ts';
import { cleanUsername, createUser, db, findUser, save, uid } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
	return {
		specialties: [...SPECIALTIES],
		plans: [...PLANS],
		towns: Object.entries(TOWN_LABEL)
			.map(([key, label]) => ({ key, label }))
			.sort((a, b) => a.label.localeCompare(b.label, 'es'))
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const f = await request.formData();
		const rawUsername = String(f.get('username') ?? '');
		const name = String(f.get('name') ?? '').trim().slice(0, 80);
		const specialty = SPECIALTIES.find((s) => s === f.get('specialty'));
		const townKey = String(f.get('town') ?? '');
		const address = String(f.get('address') ?? '').trim().slice(0, 120);
		const plans = f.getAll('plans').map(String).filter((p) => (PLANS as readonly string[]).includes(p));

		const values = { username: rawUsername, name, address };
		const username = cleanUsername(rawUsername);
		if (!username)
			return fail(400, {
				...values,
				message: 'El usuario debe tener de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.'
			});
		if (findUser(username)) return fail(400, { ...values, message: 'Ese usuario ya está en uso. Escoge otro.' });
		if (!name) return fail(400, { ...values, message: 'Escribe el nombre de la oficina.' });
		if (!specialty) return fail(400, { ...values, message: 'Escoge una especialidad.' });
		const region = TOWN_REGION[townKey];
		if (!region) return fail(400, { ...values, message: 'Escoge el pueblo de la oficina.' });
		if (!address) return fail(400, { ...values, message: 'Escribe la dirección de la oficina.' });
		if (!plans.length) return fail(400, { ...values, message: 'Escoge al menos un plan médico que aceptas.' });

		const clinic = {
			id: uid(),
			name,
			specialty,
			region,
			town: TOWN_LABEL[townKey],
			address,
			acceptedPlans: plans
		};
		db().clinics.push(clinic);
		save();
		const user = createUser(username, 'clinic', clinic.id);

		startSession(cookies, user.id, url.protocol === 'https:');
		redirect(303, homeFor(user.role));
	}
};

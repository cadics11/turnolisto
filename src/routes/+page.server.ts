import { fail, redirect } from '@sveltejs/kit';
import { homeFor, startSession } from '#lib/server/auth.ts';
import { cleanUsername, createUser, findUser } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
};

const BAD_NAME = 'El usuario debe tener de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.';

export const actions: Actions = {
	/** Patient: signs in with just a username; the account is created on first use. */
	patient: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const raw = String(data.get('username') ?? '');
		const username = cleanUsername(raw);
		if (!username) return fail(400, { tab: 'patient', username: raw, message: BAD_NAME });

		let user = findUser(username);
		if (user && user.role !== 'patient')
			return fail(400, {
				tab: 'patient',
				username: raw,
				message: 'Ese usuario pertenece a una oficina. Usa la pestaña "Oficina".'
			});
		user ??= createUser(username, 'patient');

		startSession(cookies, user.id, url.protocol === 'https:');
		redirect(303, homeFor(user.role));
	},

	/** Clinic: signs in with the username it registered. */
	clinic: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const raw = String(data.get('username') ?? '');
		const username = cleanUsername(raw);
		if (!username) return fail(400, { tab: 'clinic', username: raw, message: BAD_NAME });

		const user = findUser(username);
		if (!user || user.role !== 'clinic')
			return fail(400, {
				tab: 'clinic',
				username: raw,
				message: 'No encontramos una oficina con ese usuario. Si es nueva, regístrala primero.'
			});

		startSession(cookies, user.id, url.protocol === 'https:');
		redirect(303, homeFor(user.role));
	}
};

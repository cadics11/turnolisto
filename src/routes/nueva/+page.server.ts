import { fail, redirect } from '@sveltejs/kit';
import { PLANS, REGIONS, SPECIALTIES } from '#lib/constants.ts';
import { bookOpening, joinWaitlist, type RequestFields } from '#lib/server/matcher.ts';
import { config } from '#lib/server/config.ts';
import { phoneDigits } from '#lib/server/sms.ts';
import { db } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** Name and phone come from the patient profile; without them the patient is sent to finish it. */
function profileOrRedirect(userId: string) {
	const account = db().users.find((u) => u.id === userId);
	const phone = phoneDigits(account?.phone ?? '');
	if (!account || !account.name || phone.length !== 10) redirect(303, '/perfil?next=nueva');
	return { name: account.name, phone };
}

export const load: PageServerLoad = ({ locals }) => {
	profileOrRedirect(locals.user!.id);
	return {
		smsAlerts: locals.user!.smsAlerts !== false,
		// With a Gemini key the live voice assistant is the only voice UI; without one the typed chat is the fallback.
		liveEnabled: Boolean(config.geminiApiKey)
	};
};

/** Validates the request fields the browser kept from the chat. */
function parseFields(raw: FormDataEntryValue | null): RequestFields | null {
	let fields: Record<string, unknown> = {};
	try {
		fields = JSON.parse(String(raw ?? '{}'));
	} catch {
		return null;
	}
	const specialty = SPECIALTIES.find((s) => s === fields.specialty);
	const region = REGIONS.find((r) => r === fields.region);
	const plan = PLANS.find((p) => p === fields.plan);
	const preferredDays = typeof fields.preferredDays === 'string' ? fields.preferredDays.slice(0, 60) : '';
	if (!specialty || !region || !plan || !preferredDays) return null;
	return {
		specialty,
		region,
		plan,
		preferredDays,
		hasReferral: fields.hasReferral === true,
		town: typeof fields.town === 'string' ? fields.town.slice(0, 40) : ''
	};
}

const BAD_FIELDS = 'Faltan datos de la solicitud. Empieza de nuevo, por favor.';

export const actions: Actions = {
	/** The patient picked one of the openings shown in the chat. */
	book: async ({ request, locals }) => {
		const contact = profileOrRedirect(locals.user!.id);
		const data = await request.formData();
		const fields = parseFields(data.get('fields'));
		if (!fields) return fail(400, { message: BAD_FIELDS });
		const r = await bookOpening(locals.user!.id, String(data.get('slot') ?? ''), fields, contact);
		if (!r.ok) return fail(400, { message: r.message, taken: r.reason === 'taken' });
		redirect(303, `/solicitud/${r.code}`);
	},

	/** Nothing open (or none wanted): join the line and get alerted when a slot opens. */
	wait: async ({ request, locals }) => {
		const contact = profileOrRedirect(locals.user!.id);
		const data = await request.formData();
		const fields = parseFields(data.get('fields'));
		if (!fields) return fail(400, { message: BAD_FIELDS });
		const r = await joinWaitlist(locals.user!.id, fields, contact);
		if (!r.ok) return fail(400, { message: r.message });
		redirect(303, `/solicitud/${r.code}`);
	}
};

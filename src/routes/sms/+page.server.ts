import { fail } from '@sveltejs/kit';
import { handleInboundSms } from '#lib/server/matcher.ts';
import { db } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** Phones the signed-in patient has used on their own requests. Nothing else is visible. */
function myPhones(userId: string): Set<string> {
	return new Set(
		db()
			.requests.filter((r) => r.userId === userId)
			.map((r) => r.patientPhone)
	);
}

export const load: PageServerLoad = ({ url, locals }) => {
	const d = db();
	const mine = myPhones(locals.user!.id);
	const msgs = d.sms.filter((m) => mine.has(m.phone));
	const who = locals.user!.name || locals.user!.username;

	// One thread per phone that has any messages, newest activity first.
	const latest = new Map<string, string>();
	for (const m of msgs) latest.set(m.phone, m.createdAt);
	const phones = [...latest.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([p]) => p);

	const wanted = url.searchParams.get('p');
	const selected = wanted && mine.has(wanted) ? wanted : (phones[0] ?? null);

	return {
		threads: phones.map((p) => ({ phone: p, name: who, count: msgs.filter((m) => m.phone === p).length })),
		selected,
		selectedName: selected ? who : null,
		messages: selected ? msgs.filter((m) => m.phone === selected) : []
	};
};

export const actions: Actions = {
	reply: async ({ request, locals }) => {
		const f = await request.formData();
		const phone = String(f.get('phone') ?? '');
		const body = String(f.get('body') ?? '').trim().slice(0, 300);
		if (!myPhones(locals.user!.id).has(phone)) return fail(403, { message: 'Ese número no es tuyo.' });
		if (body) await handleInboundSms(phone, body);
	}
};

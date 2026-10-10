import { db } from '#lib/server/store.ts';
import { queuePosition, removeRequest } from '#lib/server/matcher.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const d = db();
	const requests = d.requests
		.filter((r) => r.userId === locals.user!.id)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map((r) => {
			const slot = r.status === 'booked' ? d.slots.find((s) => s.requestId === r.id && s.status === 'booked') : undefined;
			const clinic = slot && d.clinics.find((c) => c.id === slot.clinicId);
			return {
				code: r.code,
				specialty: r.specialty,
				region: r.region,
				plan: r.plan,
				status: r.status,
				createdAt: r.createdAt,
				notice: r.notice ?? null,
				position: r.status === 'waiting' ? queuePosition(r) : null,
				appointment: slot && clinic ? { startsAt: slot.startsAt, clinic: clinic.name } : null
			};
		});
	return { requests };
};

export const actions: Actions = {
	/** Remove one cancelled request from the list. */
	remove: async ({ request, locals }) => {
		const f = await request.formData();
		removeRequest(String(f.get('code') ?? ''), locals.user!.id);
	},

	/** Remove every cancelled request at once. */
	clear: async ({ locals }) => {
		const d = db();
		for (const r of d.requests.filter((x) => x.userId === locals.user!.id && x.status === 'cancelled')) {
			removeRequest(r.code, locals.user!.id);
		}
	}
};

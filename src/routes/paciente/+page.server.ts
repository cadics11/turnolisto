import { db } from '#lib/server/store.ts';
import { queuePosition } from '#lib/server/matcher.ts';
import type { PageServerLoad } from './$types';

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
				position: r.status === 'waiting' ? queuePosition(r) : null,
				appointment: slot && clinic ? { startsAt: slot.startsAt, clinic: clinic.name } : null
			};
		});
	return { requests };
};

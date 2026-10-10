import { error, json } from '@sveltejs/kit';
import { PLANS, REGIONS, SPECIALTIES } from '#lib/constants.ts';
import { findOpenings } from '#lib/server/matcher.ts';
import type { RequestHandler } from './$types';

// Up to 3 open slots for a patient's request, for the typed chat. Same search the voice
// assistant uses. Values are checked against the fixed lists before they are used.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { fields?: Record<string, unknown> } | null;
	const f = body?.fields;
	if (!f || typeof f !== 'object') error(400, 'Bad request');
	const specialty = SPECIALTIES.find((s) => s === f.specialty);
	const region = REGIONS.find((r) => r === f.region);
	const plan = PLANS.find((p) => p === f.plan);
	if (!specialty || !region || !plan) error(400, 'Bad request');
	const town = typeof f.town === 'string' ? f.town.slice(0, 40) : '';
	return json({ openings: findOpenings(locals.user!.id, { specialty, region, plan, town }, 3) });
};

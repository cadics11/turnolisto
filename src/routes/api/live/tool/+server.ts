import { error, json } from '@sveltejs/kit';
import { LIVE_EMERGENCY_REPLY, mergeLiveIntake, slotsFromParts, type IntakeFields } from '#lib/server/ai.ts';
import { runMatching } from '#lib/server/matcher.ts';
import { addSlots } from '#lib/server/slots.ts';
import { db } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

// Executes the function calls made by the Gemini Live model. Called by the WebSocket
// proxy with the user's own session cookie, so the same role rules as the forms apply.
// The model never sees the patient's name or phone, and no medical details are stored.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Unauthorized');

	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		args?: unknown;
		state?: { fields?: IntakeFields };
	} | null;
	if (!body || typeof body.name !== 'string') error(400, 'Bad request');
	const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};

	if (body.name === 'update_request') {
		if (user.role !== 'patient') error(403, 'Forbidden');
		const prev = body.state?.fields && typeof body.state.fields === 'object' ? body.state.fields : {};
		const r = mergeLiveIntake(prev, args);
		if (r.emergency) {
			return json({
				response: { emergency: true, instruction: `Tell the person, in Spanish: ${LIVE_EMERGENCY_REPLY}` }
			});
		}
		return json({
			fields: r.fields,
			done: r.done,
			nextAsk: r.nextAsk,
			response: {
				saved: r.fields,
				still_missing: r.missing,
				ignored_values: r.ignored,
				done: r.done,
				instruction: r.done
					? 'Everything is collected. Tell the person, in Spanish, that you have everything and that they should now type their name and phone number in the form on the screen, because the clinic only sees them after they accept a slot. Do not ask for the name or phone out loud.'
					: `Briefly confirm what you understood, then ask only this next question in Spanish: ${r.question}${
							r.ignored.length ? ` (These values were not recognised and must be asked again: ${r.ignored.join(', ')}.)` : ''
						}`
			}
		});
	}

	if (body.name === 'publish_slots') {
		if (user.role !== 'clinic') error(403, 'Forbidden');
		const clinic = db().clinics.find((c) => c.id === user.clinicId);
		if (!clinic) error(404, 'Oficina no encontrada');
		const cmd = slotsFromParts(args);
		if (!cmd) {
			return json({
				response: {
					ok: false,
					instruction: 'The date or start time was missing or invalid. Ask the clinic for it in Spanish, then call publish_slots again.'
				}
			});
		}
		const added = addSlots(clinic, cmd.startsAt, cmd.durationMin);
		await runMatching();
		return json({
			slots: { summary: cmd.summary, added },
			response: {
				ok: added > 0,
				added,
				summary: cmd.summary,
				instruction:
					added > 0
						? 'Confirm out loud in Spanish what was published and that TurnoListo is now looking for patients.'
						: 'No slots were added because those times are in the past or already published. Tell the clinic in Spanish and ask for another time.'
			}
		});
	}

	error(400, 'Unknown tool');
};

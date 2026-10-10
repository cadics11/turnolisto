import { error, json } from '@sveltejs/kit';
import { LIVE_EMERGENCY_REPLY, mergeLiveIntake, slotsFromParts, type IntakeFields } from '#lib/server/ai.ts';
import { bookOpening, findOpenings, joinWaitlist, runMatching, type RequestFields } from '#lib/server/matcher.ts';
import { addSlots } from '#lib/server/slots.ts';
import { phoneDigits } from '#lib/server/sms.ts';
import { db } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** The request fields, only if every one of them was collected. */
function completeFields(f: IntakeFields | undefined): RequestFields | null {
	if (!f || !f.specialty || !f.region || !f.plan || !f.preferredDays || typeof f.hasReferral !== 'boolean') return null;
	return {
		specialty: f.specialty,
		region: f.region,
		town: f.town ?? '',
		plan: f.plan,
		preferredDays: f.preferredDays,
		hasReferral: f.hasReferral
	};
}

// Executes the function calls made by the Gemini Live model. Called by the WebSocket
// proxy with the user's own session cookie, so the same role rules as the forms apply.
// The model never sees the patient's name or phone, and no medical details are stored.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Unauthorized');

	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		args?: unknown;
		state?: { fields?: IntakeFields; openings?: string[] };
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
					? 'Everything is collected. Tell the person in Spanish that you are checking for openings, and call find_openings now. Do not ask for the name or phone: they are already in the patient profile.'
					: `Briefly confirm what you understood, then ask only this next question in Spanish: ${r.question}${
							r.ignored.length ? ` (These values were not recognised and must be asked again: ${r.ignored.join(', ')}.)` : ''
						}`
			}
		});
	}

	if (body.name === 'find_openings' || body.name === 'choose_opening' || body.name === 'join_waitlist') {
		if (user.role !== 'patient') error(403, 'Forbidden');
		const account = db().users.find((u) => u.id === user.id);
		if (!account || !account.name || phoneDigits(account.phone).length !== 10) {
			return json({
				response: {
					ok: false,
					instruction:
						'The patient has not completed their profile (name and phone). Tell them in Spanish to fill in their profile first, at the link "Mi perfil". Do not continue.'
				}
			});
		}
		const f = completeFields(body.state?.fields);
		if (!f) {
			return json({
				response: {
					ok: false,
					instruction:
						'The request is still missing the specialty, area, plan, days or referral. Ask the patient for what is missing and call update_request.'
				}
			});
		}
		const contact = { name: account.name, phone: phoneDigits(account.phone) };

		if (body.name === 'find_openings') {
			const openings = findOpenings(user.id, f, 3);
			if (!openings.length) {
				return json({
					openings: [],
					response: {
						ok: true,
						count: 0,
						instruction:
							'There are no openings right now. Tell the patient in Spanish that nothing is open at the moment. Do NOT suggest or name any doctor, clinic, hospital or phone number, because you only know the clinics registered in TurnoListo and none has an opening. Offer to put them on the waiting list: as soon as an opening appears they get an alert and can book it. If they agree, call join_waitlist.'
					}
				});
			}
			return json({
				openings,
				response: {
					ok: true,
					count: openings.length,
					openings: openings.map((o, i) => ({
						number: i + 1,
						clinic: o.clinic,
						town: o.town,
						when: o.when,
						distance: o.distance || 'distance unknown',
						say: `Opción ${i + 1}: ${o.clinic}, en ${o.town}${o.distance ? `, a ${o.distance}` : ''}, ${o.when}.`
					})),
					instruction:
						'Read ONLY these openings aloud, using each "say" text as written. Do not add, change or invent any clinic, doctor, address, phone, time or distance, and do not mention anything that is not in this list. Then ask which one they want, or whether they prefer to wait for another. When they choose, call choose_opening with that number. If they want none, offer the waiting list and call join_waitlist if they agree.'
				}
			});
		}

		if (body.name === 'choose_opening') {
			const shown = Array.isArray(body.state?.openings) ? body.state.openings : [];
			const n = typeof args.number === 'number' ? Math.round(args.number) : NaN;
			const slotId = shown[n - 1];
			if (!slotId) {
				return json({
					response: { ok: false, instruction: 'That number was not one of the openings read. Ask which of the numbers they want.' }
				});
			}
			const r = await bookOpening(user.id, slotId, f, contact);
			if (!r.ok) {
				return json({
					response: {
						ok: false,
						reason: r.reason,
						instruction:
							r.reason === 'taken'
								? 'That opening was just taken by someone else. Tell the patient in Spanish, and call find_openings again to read the new options.'
								: `Tell the patient in Spanish: ${r.message}`
					}
				});
			}
			return json({
				booked: { code: r.code },
				response: {
					ok: true,
					instruction:
						'The appointment is booked. Confirm out loud in Spanish, briefly, and say a text message (if they have alerts on) and the app have the details. Remind them the clinic now sees their name and phone.'
				}
			});
		}

		// join_waitlist
		const r = await joinWaitlist(user.id, f, contact);
		if (!r.ok) {
			return json({ response: { ok: false, instruction: `Tell the patient in Spanish: ${r.message}` } });
		}
		return json({
			waiting: { code: r.code },
			response: {
				ok: true,
				instruction: account.smsAlerts
					? 'They are on the waiting list. Tell the patient in Spanish that they will get a text message as soon as an opening appears, and they can accept it by replying SI.'
					: 'They are on the waiting list. Tell the patient in Spanish that, since they turned SMS alerts off, they should check the app: the opening will show up there when it appears.'
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

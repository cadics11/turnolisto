import { json, error } from '@sveltejs/kit';
import { parseIntake, type ChatMessage, type IntakeFields } from '#lib/server/ai.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		messages?: ChatMessage[];
		fields?: IntakeFields;
		lastAsked?: string | null;
	} | null;
	if (!body || !Array.isArray(body.messages)) error(400, 'Bad request');

	const messages = body.messages
		.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
		.map((m) => ({ role: m.role, text: m.text.slice(0, 500) }));

	const result = await parseIntake(messages, body.fields ?? {}, body.lastAsked ?? null);
	return json(result);
};

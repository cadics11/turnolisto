// Twilio "A message comes in" webhook. Point your Twilio number at
// https://<your-public-url>/api/sms/inbound (HTTP POST).
// Replies are sent through the REST API (sms.ts), so we return empty TwiML.
import { handleInboundSms } from '#lib/server/matcher.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const from = String(form.get('From') ?? '');
	const body = String(form.get('Body') ?? '');
	if (from && body) await handleInboundSms(from, body);
	return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
		headers: { 'Content-Type': 'text/xml' }
	});
};

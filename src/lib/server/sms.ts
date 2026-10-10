import { config } from './config.ts';
import { db, save, uid } from './store.ts';

export function phoneDigits(p: string): string {
	return p.replace(/\D/g, '').slice(-10);
}

function toE164(p: string): string {
	return '+1' + phoneDigits(p);
}

/** Logs the message (visible in /sms) and, in twilio mode, actually sends it. */
export async function sendSms(phone: string, body: string) {
	const digits = phoneDigits(phone);
	db().sms.push({
		id: uid(),
		direction: 'out',
		phone: digits,
		body,
		createdAt: new Date().toISOString()
	});
	save();

	if (config.smsMode !== 'twilio') return;
	if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) {
		console.warn('[sms] SMS_MODE=twilio but Twilio credentials are missing; message only logged.');
		return;
	}
	try {
		const res = await fetch(
			`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`,
			{
				method: 'POST',
				headers: {
					Authorization:
						'Basic ' + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64'),
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams({ To: toE164(digits), From: config.twilioFrom, Body: body })
			}
		);
		if (!res.ok) console.error('[sms] Twilio error', res.status, await res.text());
	} catch (e) {
		console.error('[sms] Twilio request failed', e);
	}
}

export function logInbound(phone: string, body: string, aiNote?: string) {
	db().sms.push({
		id: uid(),
		direction: 'in',
		phone: phoneDigits(phone),
		body,
		createdAt: new Date().toISOString(),
		aiNote
	});
	save();
}

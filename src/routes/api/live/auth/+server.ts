import { error, json } from '@sveltejs/kit';
import { config } from '#lib/server/config.ts';
import type { RequestHandler } from './$types';

// Used by the WebSocket proxy to check the session cookie before upgrading,
// and by the UI to know whether the server has a Gemini key. The key itself is never returned.
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	return json({ configured: Boolean(config.geminiApiKey) });
};

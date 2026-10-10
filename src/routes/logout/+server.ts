import { redirect } from '@sveltejs/kit';
import { endSession } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
	endSession(cookies);
	redirect(303, '/');
};

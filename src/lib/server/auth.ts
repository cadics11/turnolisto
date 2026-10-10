// Username-only authentication. There is no password: knowing a username is enough
// to sign in as that user, so this is only as safe as usernames are private.
import type { Cookies } from '@sveltejs/kit';
import { createSession, destroySession } from './store.ts';

export const SESSION_COOKIE = 'tl_session';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function startSession(cookies: Cookies, userId: string, secure: boolean) {
	cookies.set(SESSION_COOKIE, createSession(userId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: THIRTY_DAYS
	});
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) destroySession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Where each role lands after signing in. */
export const homeFor = (role: 'patient' | 'clinic') => (role === 'clinic' ? '/oficina' : '/paciente');

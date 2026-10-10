import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { expireOffers } from '#lib/server/matcher.ts';
import { SESSION_COOKIE, homeFor } from '#lib/server/auth.ts';
import { userForSession, loadDb, flush } from '#lib/server/store.ts';

// Check for expired SMS offers every 30 seconds.
const g = globalThis as unknown as { __turnolistoTimer?: ReturnType<typeof setInterval> };
if (!g.__turnolistoTimer) {
	g.__turnolistoTimer = setInterval(() => {
		loadDb().then(() => expireOffers()).then(flush).catch((e) => console.error('[expireOffers]', e));
	}, 30_000);
}

/** Pages that need a signed-in user, and which role may open them. */
const GUARDED: { prefix: string; role: 'patient' | 'clinic' }[] = [
	{ prefix: '/paciente', role: 'patient' },
	{ prefix: '/nueva', role: 'patient' },
	{ prefix: '/solicitud', role: 'patient' },
	{ prefix: '/sms', role: 'patient' },
	{ prefix: '/api/intake', role: 'patient' },
	{ prefix: '/api/openings', role: 'patient' },
	{ prefix: '/perfil', role: 'patient' },
	{ prefix: '/oficina', role: 'clinic' }
];

export const handle: Handle = async (input) => {
	await loadDb();
	try {
		return await handleInner(input);
	} finally {
		await flush();
	}
};

const handleInner: Handle = async ({ event, resolve }) => {
	event.locals.user = userForSession(event.cookies.get(SESSION_COOKIE));

	const path = event.url.pathname;
	const rule = GUARDED.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
	if (rule) {
		const user = event.locals.user;
		if (!user) {
			if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
			redirect(303, '/');
		}
		if (user.role !== rule.role) {
			if (path.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
			redirect(303, homeFor(user.role));
		}
	}
	return resolve(event);
};


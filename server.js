// Production server for TurnoListo (run `npm run build` then `npm start`).
// It wraps SvelteKit's Node handler to fix two things for a hackathon setup:
//  1. SvelteKit assumes https by default. Locally we run on plain http, so we pass
//     the real protocol via X-Forwarded-Proto (ngrok/hosting already set it).
//  2. Twilio's webhook POST has no Origin header, which SvelteKit's CSRF check
//     rejects. We add a same-origin header for that one route only.
import http from 'node:http';

process.env.PROTOCOL_HEADER ??= 'x-forwarded-proto';
const { handler } = await import('./build/handler.js');

const port = Number(process.env.PORT ?? 3000);

// Load .env so GEMINI_API_KEY is available to the WebSocket proxy (the SvelteKit build inlines it separately).
try {
	process.loadEnvFile('.env');
} catch {
	/* no .env: rely on the real environment */
}
const { attachGeminiLiveProxy, cookieAuthorizer, cookieToolRunner } = await import('./src/lib/server/geminiLiveProxy.js');

const server = http
	.createServer((req, res) => {
		if (!req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = 'http';
		if (req.url?.startsWith('/api/sms/inbound') && !req.headers.origin) {
			const proto = String(req.headers['x-forwarded-proto']).split(',')[0].trim();
			req.headers.origin = `${proto}://${req.headers.host}`;
		}
		handler(req, res, () => {
			res.statusCode = 404;
			res.end('Not found');
		});
	});

// Gemini Live WebSocket proxy at /api/live
attachGeminiLiveProxy(server, {
	apiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
	authorize: cookieAuthorizer(() => `http://127.0.0.1:${port}`),
	runTool: cookieToolRunner(() => `http://127.0.0.1:${port}`)
});

server.listen(port, () => console.log(`TurnoListo running at http://localhost:${port}`));

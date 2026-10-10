import { error, json } from '@sveltejs/kit';
import { GoogleGenAI, Modality } from '@google/genai';
import { config } from '#lib/server/config.ts';
import { DEFAULT_MODEL, TOOLS, buildInstructions } from '#lib/server/liveConfig.js';
import type { RequestHandler } from './$types';

// Mints a short-lived, single-use Gemini Live token so the browser can talk to Gemini
// directly (Vercel functions cannot hold WebSockets). The real API key never leaves the
// server, and the system prompt, tools and model are locked inside the token.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Unauthorized');
	if (!config.geminiApiKey) error(503, 'GEMINI_API_KEY no está configurada en el servidor.');

	const body = (await request.json().catch(() => null)) as { context?: unknown } | null;
	const context = body?.context === 'nueva' || body?.context === 'oficina' ? body.context : 'default';
	// Same role rules as the pages that use each context.
	if (context === 'nueva' && user.role !== 'patient') error(403, 'Forbidden');
	if (context === 'oficina' && user.role !== 'clinic') error(403, 'Forbidden');

	const model = (process.env.GEMINI_LIVE_MODEL ?? '').trim() || DEFAULT_MODEL;
	const instructions = buildInstructions(new Date());
	const tools = TOOLS[context as keyof typeof TOOLS];

	const ai = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { apiVersion: 'v1alpha' } });
	try {
		const token = await ai.authTokens.create({
			config: {
				uses: 1,
				expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
				newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
				liveConnectConstraints: {
					model,
					config: {
						responseModalities: [Modality.AUDIO],
						temperature: 0.3, // low: stick to the data from the tools instead of improvising
						inputAudioTranscription: {},
						outputAudioTranscription: {},
						systemInstruction: instructions[context as keyof typeof instructions] ?? instructions.default,
						...(tools ? { tools: [{ functionDeclarations: tools }] } : {})
					}
				}
			}
		});
		return json({ token: token.name, model });
	} catch (e) {
		console.error('[live/token]', e instanceof Error ? e.message : e);
		error(502, 'No se pudo conectar con Gemini.');
	}
};

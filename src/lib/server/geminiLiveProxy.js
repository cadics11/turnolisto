// WebSocket bridge: browser <-> this server <-> Gemini Live API.
// Plain JS with no SvelteKit aliases so it can be loaded by both the Vite dev
// server (vite.config.ts) and the production server (server.js).
// The Gemini API key never leaves the server.
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';

export const LIVE_PATH = '/api/live';

// Logging: every line goes to the console and is appended to LOG_FILE.
// Follow it with:  tail -f logs/live.log
// Set GEMINI_LIVE_LOG=off to disable. Raw audio is never logged (only chunk counts/sizes).
const LOG_ENABLED = (process.env.GEMINI_LIVE_LOG ?? 'on').toLowerCase() !== 'off';
const LOG_FILE = path.resolve(process.env.GEMINI_LIVE_LOG_FILE || 'logs/live.log');
let logDirReady = false;
let nextId = 1;

/**
 * @param {string} id connection id
 * @param {string} event
 * @param {unknown} [data]
 */
function log(id, event, data) {
	if (!LOG_ENABLED) return;
	let extra = '';
	if (data !== undefined) {
		try {
			extra = ' ' + (typeof data === 'string' ? data : JSON.stringify(data));
		} catch {
			extra = ' [unserializable]';
		}
	}
	const line = `${new Date().toISOString()} [live ${id}] ${event}${extra}`;
	console.log(line);
	try {
		if (!logDirReady) {
			fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
			logDirReady = true;
		}
		fs.appendFileSync(LOG_FILE, line + '\n');
	} catch {
		// file logging is best-effort
	}
}

// gemini-2.0-flash-exp is retired. Override with GEMINI_LIVE_MODEL if Google renames the model.
const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

/** @param {Date} now */
function buildInstructions(now) {
	const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const weekday = now.toLocaleDateString('es-PR', { weekday: 'long' });
	return {
		nueva: [
			'Eres el asistente de voz de TurnoListo en Puerto Rico. Ayudas a un paciente a pedir una cita con un especialista.',
			'Necesitas cinco datos: especialidad, pueblo o área, plan médico, días preferidos y si ya tiene el referido de su médico primario.',
			'Cada vez que el paciente te dé uno o más datos, llama a la función update_request con lo que dijo (solo los datos nuevos). La función te dirá qué falta y qué preguntar; sigue esas indicaciones.',
			'Haz una sola pregunta a la vez, con frases cortas, en español. No hables de funciones ni de procesos internos.',
			'No pidas el nombre ni el teléfono: ya están en el perfil del paciente.',
			'REGLA ESTRICTA: solo puedes mencionar oficinas, médicos, direcciones, horarios y distancias que te devuelva la función find_openings en esta conversación. Nunca inventes ni recomiendes médicos, clínicas, hospitales, teléfonos o páginas web que no vengan de esa función, y no uses tu conocimiento general para sugerir lugares.',
			'No hables de turnos ni de oficinas antes de que find_openings te devuelva resultados. Al leer los turnos usa el texto que te da la función, sin añadir ni cambiar nada.',
			'Si el paciente pregunta por un médico u oficina en particular, o por algo que no sea pedir una cita, responde que solo puedes ayudar con los turnos de las oficinas registradas en TurnoListo y vuelve a la pregunta pendiente.',
			'Cuando tengas los cinco datos, llama a find_openings. Si hay turnos, léelos en voz alta (máximo 3, con número, oficina, pueblo, distancia en millas, fecha y hora) y pregunta cuál quiere. Cuando elija, llama a choose_opening con su número.',
			'Si no hay turnos, o no quiere ninguno, ofrece ponerlo en lista de espera: cuando se abra un turno recibirá un aviso para reservarlo. Si acepta, llama a join_waitlist.',
			'Nunca guardes ni repitas síntomas, diagnósticos o medicamentos. No des consejo médico ni juzgues urgencia. Si describe una emergencia, llama a update_request con emergency=true y sigue sus indicaciones.'
		].join(' '),
		oficina: [
			'Eres el asistente de voz de TurnoListo para oficinas médicas en Puerto Rico. Ayudas a la oficina a publicar turnos disponibles.',
			`Hoy es ${weekday} ${today}. Si dicen un día de la semana, usa el próximo que venga. Las horas sin am/pm entre 1 y 7 son de la tarde.`,
			'Cuando tengas fecha y hora de inicio, llama a la función publish_slots (con la hora final, la cantidad de turnos o la duración si las dieron). Si falta la fecha o la hora de inicio, pregunta solo eso.',
			'Cuando la función termine, confirma en voz alta qué se publicó. Habla en español, con frases cortas. No hables de funciones ni de procesos internos.'
		].join(' '),
		default: 'Eres un asistente de voz amable de TurnoListo. Responde en español, con frases cortas.'
	};
}

const str = (/** @type {string} */ description) => ({ type: Type.STRING, description });

/**
 * Function declarations per page. The app validates every value again when the call runs.
 * @type {Record<string, import('@google/genai').FunctionDeclaration[]>}
 */
const TOOLS = {
	nueva: [
		{
			name: 'update_request',
			description:
				'Guarda los datos de la solicitud de cita que el paciente acaba de decir. Envía solo los que dijo. Devuelve lo que falta y la próxima pregunta.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					specialty: str(
						'Especialidad que el paciente nombró: Ortodoncia, Neurología, Cardiología, Dermatología, Endocrinología, Gastroenterología, Ortopedia o Psiquiatría. No la deduzcas de síntomas.'
					),
					town: str('Pueblo de Puerto Rico, por ejemplo Arecibo o San Juan.'),
					region: str('Área de la isla: Norte, Sur, Este, Oeste, Metro o Centro. Solo si no dio un pueblo.'),
					plan: str(
						'Plan médico: Triple-S, MCS, Plan Vital (también la Reforma o plan del gobierno), First Medical o Medicare Advantage.'
					),
					preferred_days: str('Días preferidos en texto corto en español, por ejemplo "Martes o jueves, tardes" o "Cualquier día".'),
					has_referral: { type: Type.BOOLEAN, description: 'true si ya tiene el referido de su médico primario, false si no.' },
					emergency: { type: Type.BOOLEAN, description: 'true solo si describe una emergencia médica o de salud mental.' }
				}
			}
		},
		{
			name: 'find_openings',
			description:
				'Busca hasta 3 turnos abiertos que coincidan con la solicitud (especialidad, plan y cercanía). Llámala cuando ya estén los cinco datos.',
			parameters: { type: Type.OBJECT, properties: {} }
		},
		{
			name: 'choose_opening',
			description: 'Reserva el turno que el paciente eligió entre los que acabas de leer.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					number: { type: Type.INTEGER, description: 'Número del turno elegido: 1, 2 o 3.' }
				},
				required: ['number']
			}
		},
		{
			name: 'join_waitlist',
			description:
				'Pone al paciente en lista de espera cuando no hay turnos o no quiso ninguno. Recibirá un aviso cuando se abra uno.',
			parameters: { type: Type.OBJECT, properties: {} }
		}
	],
	oficina: [
		{
			name: 'publish_slots',
			description: 'Publica turnos disponibles de la oficina y empieza a buscar pacientes.',
			parameters: {
				type: Type.OBJECT,
				properties: {
					date: str('Fecha en formato YYYY-MM-DD.'),
					start: str('Hora de inicio en 24 horas, formato HH:MM.'),
					end: str('Hora final en 24 horas, formato HH:MM, si la dieron.'),
					count: { type: Type.INTEGER, description: 'Cantidad de turnos, si la dieron.' },
					duration_min: { type: Type.INTEGER, description: 'Duración de cada turno en minutos, si la dieron.' }
				},
				required: ['date', 'start']
			}
		}
	]
};

/**
 * Builds `runTool(req, name, args, state)`: executes a model function call inside the
 * SvelteKit app using the user's own session cookie (so roles and validation apply).
 * @param {() => string} getBaseUrl
 */
export function cookieToolRunner(getBaseUrl) {
	return async (
		/** @type {import('node:http').IncomingMessage} */ req,
		/** @type {string} */ name,
		/** @type {Record<string, unknown>} */ args,
		/** @type {{ fields: Record<string, unknown>, openings: string[] }} */ state
	) => {
		const base = getBaseUrl();
		const res = await fetch(`${base}/api/live/tool`, {
			method: 'POST',
			headers: { cookie: req.headers.cookie ?? '', 'content-type': 'application/json', origin: base },
			body: JSON.stringify({ name, args, state })
		});
		if (!res.ok) throw new Error(`tool endpoint answered ${res.status}`);
		return /** @type {Promise<any>} */ (res.json());
	};
}

/**
 * Builds an `authorize(req)` that asks the SvelteKit app whether the request's
 * session cookie belongs to a signed-in user.
 * @param {() => string} getBaseUrl
 */
export function cookieAuthorizer(getBaseUrl) {
	return async (/** @type {import('node:http').IncomingMessage} */ req) => {
		try {
			const res = await fetch(`${getBaseUrl()}/api/live/auth`, {
				headers: { cookie: req.headers.cookie ?? '' }
			});
			return res.ok;
		} catch {
			return false;
		}
	};
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ apiKey: string, authorize: (req: import('node:http').IncomingMessage) => Promise<boolean>, runTool?: ReturnType<typeof cookieToolRunner>, model?: string }} opts
 */
export function attachGeminiLiveProxy(httpServer, { apiKey, authorize, runTool, model }) {
	const wss = new WebSocketServer({ noServer: true });
	const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

	httpServer.on('upgrade', async (req, socket, head) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (url.pathname !== LIVE_PATH) return; // leave other upgrades (e.g. Vite HMR) alone

		const reject = (/** @type {string} */ line) => {
			log('-', 'upgrade rejected', { status: line, origin: req.headers.origin, host: req.headers.host });
			socket.write(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`);
			socket.destroy();
		};

		// Block cross-site WebSocket hijacking.
		const origin = req.headers.origin;
		if (origin && new URL(origin).host !== req.headers.host) return reject('403 Forbidden');
		if (!(await authorize(req))) return reject('401 Unauthorized');

		wss.handleUpgrade(req, socket, head, (ws) => {
			const context = url.searchParams.get('context') ?? 'default';
			onConnection(ws, context, req);
		});
	});

	/**
	 * @param {import('ws').WebSocket} ws
	 * @param {string} context
	 * @param {import('node:http').IncomingMessage} req
	 */
	function onConnection(ws, context, req) {
		/** Fields collected so far in this session (patient intake). */
		/** @type {{ fields: Record<string, unknown>, openings: string[] }} */
		const state = { fields: {}, openings: [] };
		const id = String(nextId++);
		const stats = { audioIn: 0, audioInBytes: 0, audioOut: 0, audioOutBytes: 0 };
		const started = Date.now();
		const level = { peak: 0, sumSq: 0, n: 0, last: Date.now() };
		const useModel = model || process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
		log(id, 'client connected', { context, model: useModel });
		/** @type {(msg: unknown) => void} */
		const send = (msg) => {
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
		};

		if (!ai) {
			log(id, 'error: GEMINI_API_KEY missing');
			send({ type: 'error', message: 'GEMINI_API_KEY no está configurada en el servidor.' });
			ws.close(1011, 'missing key');
			return;
		}

		let closed = false;
		// The setup message is sent by the SDK when connect() starts.
		const sessionPromise = ai.live.connect({
			model: useModel,
			config: {
				responseModalities: [Modality.AUDIO], // the Live API allows one modality per session
				temperature: 0.3, // low: stick to the data from the tools instead of improvising
				inputAudioTranscription: {},
				outputAudioTranscription: {}, // text version of what the model says
				systemInstruction: (() => {
					const all = buildInstructions(new Date());
					return all[/** @type {keyof typeof all} */ (context)] ?? all.default;
				})(),
				...(runTool && TOOLS[/** @type {keyof typeof TOOLS} */ (context)]
					? { tools: [{ functionDeclarations: TOOLS[/** @type {keyof typeof TOOLS} */ (context)] }] }
					: {})
			},
			callbacks: {
				onopen: () => {
					log(id, 'upstream open');
					send({ type: 'ready' });
				},
				onmessage: (message) => {
					if (message.toolCall?.functionCalls?.length) {
						void handleToolCalls(message.toolCall.functionCalls);
						return;
					}
					if (message.toolCallCancellation) {
						log(id, 'tool call cancelled', message.toolCallCancellation.ids);
						return;
					}
					const sc = message.serverContent;
					if (sc) {
						// Summarize without dumping audio bytes.
						for (const p of sc.modelTurn?.parts ?? []) {
							if (p.inlineData?.data) {
								stats.audioOut++;
								stats.audioOutBytes += p.inlineData.data.length;
							}
							if (p.text) log(id, 'model text', p.text);
						}
						if (sc.inputTranscription?.text) log(id, 'user said', sc.inputTranscription.text);
						if (sc.outputTranscription?.text) log(id, 'model said', sc.outputTranscription.text);
						if (sc.interrupted) log(id, 'model interrupted');
						if (sc.turnComplete) log(id, 'turn complete', { audioChunksOut: stats.audioOut });
						if (sc.generationComplete) log(id, 'generation complete');
						send({ type: 'serverContent', serverContent: sc });
					} else {
						// setupComplete, goAway, usageMetadata, toolCall, etc.
						const { data: _data, ...rest } = /** @type {any} */ (message);
						log(id, 'upstream message', rest);
					}
				},
				onerror: (e) => {
					log(id, 'upstream error', e?.message ?? String(e));
					console.error('[geminiLive] upstream error:', e?.message ?? e);
					send({ type: 'error', message: 'Error en la conexión con Gemini.' });
				},
				onclose: (/** @type {any} */ e) => {
					log(id, 'upstream closed', { code: e?.code, reason: e?.reason, byClient: closed });
					if (!closed) ws.close(1000, 'upstream closed');
				}
			}
		});
		/** @param {{ id?: string, name?: string, args?: Record<string, unknown> }[]} calls */
		async function handleToolCalls(calls) {
			/** @type {{ id?: string, name?: string, response: Record<string, unknown> }[]} */
			const functionResponses = [];
			for (const call of calls) {
				const name = call.name ?? '';
				log(id, 'tool call', { name, args: call.args });
				/** @type {Record<string, unknown>} */
				let response;
				try {
					if (!runTool) throw new Error('tools are not enabled');
					const out = await runTool(req, name, call.args ?? {}, state);
					response = out.response ?? { ok: true };
					if (out.fields) {
						state.fields = out.fields;
						send({ type: 'intake', fields: out.fields, done: Boolean(out.done) });
					}
					if (out.openings) {
						// Remember which slots were read aloud so "number 2" maps to the right one.
						state.openings = out.openings.map((/** @type {{ slotId: string }} */ o) => o.slotId);
						send({ type: 'openings', openings: out.openings });
					}
					if (out.booked) send({ type: 'booked', code: out.booked.code });
					if (out.waiting) send({ type: 'waiting', code: out.waiting.code });
					if (out.slots) send({ type: 'slots', ...out.slots });
					log(id, 'tool result', { name, ...(out.fields ? { fields: out.fields, done: out.done } : {}), response });
				} catch (e) {
					const message = /** @type {any} */ (e)?.message ?? String(e);
					log(id, 'tool failed', { name, error: message });
					response = {
						ok: false,
						error: message,
						instruction: 'The action failed. Apologise briefly in Spanish and ask the person to try again or use the form on the screen.'
					};
				}
				functionResponses.push({ id: call.id, name: call.name, response });
			}
			try {
				const session = await sessionPromise;
				session.sendToolResponse({ functionResponses });
			} catch (e) {
				log(id, 'sending tool response failed', /** @type {any} */ (e)?.message ?? String(e));
			}
		}

		sessionPromise.catch((e) => {
			log(id, 'connect failed', e?.message ?? String(e));
			console.error('[geminiLive] connect failed:', e?.message ?? e);
			send({ type: 'error', message: 'No se pudo conectar con Gemini.' });
			ws.close(1011, 'connect failed');
		});

		ws.on('message', async (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				log(id, 'client sent invalid JSON');
				return;
			}
			try {
				const session = await sessionPromise;
				if (msg.type === 'audio' && typeof msg.data === 'string') {
					stats.audioIn++;
					stats.audioInBytes += msg.data.length;
					if (stats.audioIn === 1) log(id, 'first audio chunk from client');
					// Input level meter: tells you whether the mic is sending real sound or silence.
					const pcm = Buffer.from(msg.data, 'base64');
					for (let i = 0; i + 1 < pcm.length; i += 2) {
						const s = Math.abs(pcm.readInt16LE(i));
						if (s > level.peak) level.peak = s;
						level.sumSq += s * s;
						level.n++;
					}
					if (Date.now() - level.last >= 2000 && level.n) {
						log(id, 'mic level (last 2s)', {
							peak: Math.round((level.peak / 32767) * 1000) / 1000,
							rms: Math.round((Math.sqrt(level.sumSq / level.n) / 32767) * 1000) / 1000,
							note: level.peak < 330 ? 'SILENT/very quiet' : 'ok'
						});
						level.peak = 0;
						level.sumSq = 0;
						level.n = 0;
						level.last = Date.now();
					}
					session.sendRealtimeInput({ audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } });
				} else if (msg.type === 'state' && msg.fields && typeof msg.fields === 'object') {
					// Fields the page already has (e.g. from the typed chat), so the model doesn't re-ask them.
					state.fields = msg.fields;
					log(id, 'client state', msg.fields);
				} else if (msg.type === 'diag') {
					log(id, 'client mic diagnostics', { track: msg.track, ctx: msg.ctx, ua: msg.ua });
				} else if (msg.type === 'audioEnd') {
					log(id, 'client audioEnd', { audioChunksIn: stats.audioIn });
					session.sendRealtimeInput({ audioStreamEnd: true });
				} else if (msg.type === 'text' && typeof msg.text === 'string') {
					log(id, 'client text', msg.text.slice(0, 2000));
					session.sendRealtimeInput({ text: msg.text.slice(0, 2000) });
				}
			} catch (e) {
				log(id, 'send to upstream failed', /** @type {any} */ (e)?.message ?? String(e));
				// session failed to open or already closed; the catch above reports it
			}
		});

		const cleanup = () => {
			closed = true;
			sessionPromise.then((s) => s.close()).catch(() => {});
		};
		ws.on('close', (code, reason) => {
			log(id, 'client closed', {
				code,
				reason: reason?.toString(),
				durationMs: Date.now() - started,
				...stats
			});
			cleanup();
		});
		ws.on('error', (e) => {
			log(id, 'client socket error', e?.message ?? String(e));
			cleanup();
		});
	}

	return wss;
}

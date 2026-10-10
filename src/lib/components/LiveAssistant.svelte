<script lang="ts">
	import { onMount } from 'svelte';
	import { GoogleGenAI, Modality, type Session } from '@google/genai';
	import type { OpeningCard } from '#lib/types.ts';

	type IntakeFields = {
		specialty?: string;
		town?: string;
		region?: string;
		plan?: string;
		preferredDays?: string;
		hasReferral?: boolean;
	};

	let {
		context = 'default',
		hint = '',
		fields,
		onintake,
		onslots,
		onopenings,
		ondone
	}: {
		context?: 'nueva' | 'oficina' | 'default';
		/** Example of what to say, shown under the mic button while idle. */
		hint?: string;
		/** Fields the page already has, so the live model doesn't ask for them again. */
		fields?: IntakeFields;
		/** The model saved patient request fields. */
		onintake?: (fields: IntakeFields, done: boolean) => void;
		/** The model published clinic slots. */
		onslots?: (result: { summary: string; added: number }) => void;
		/** The model looked up openings for the patient (up to 3). */
		onopenings?: (openings: OpeningCard[]) => void;
		/** The model booked an opening or put the patient on the waiting list: go see the request. */
		ondone?: (code: string) => void;
	} = $props();

	type Status = 'disconnected' | 'connecting' | 'live' | 'listening' | 'speaking';
	type Line = { role: 'user' | 'assistant'; text: string };

	const LABELS: Record<Status, string> = {
		disconnected: 'Desconectado',
		connecting: 'Conectando…',
		live: 'En vivo',
		listening: 'Escuchando',
		speaking: 'Hablando'
	};

	let status = $state<Status>('disconnected');
	let error = $state('');
	let lines = $state<Line[]>([]);
	let typed = $state('');
	const active = $derived(status !== 'disconnected');

	// Direct connection to Gemini Live, opened with a short-lived token from /api/live/token.
	let session: Session | null = null;
	let connectGen = 0;
	// What the tool endpoint needs to remember between calls (collected fields, openings read aloud).
	let toolState: { fields: Record<string, unknown>; openings: string[] } = { fields: {}, openings: [] };
	let micCtx: AudioContext | null = null;
	let micStream: MediaStream | null = null;
	let micNode: AudioWorkletNode | null = null;
	let outCtx: AudioContext | null = null;
	let playHead = 0;
	const sources = new Set<AudioBufferSourceNode>();
	let micOn = false;
	let lastRole: Line['role'] | null = null;
	let speakingTimer: ReturnType<typeof setTimeout> | undefined;

	// The session ends by itself after this long with nobody talking (you or the assistant).
	const SILENCE_MS = 6000;
	// Peak of a 16-bit sample (max 32767) that counts as someone speaking rather than background noise.
	const SPEECH_PEAK = 1500;
	let notice = $state('');
	let lastActivity = 0;
	let micPending = false;
	let silenceTimer: ReturnType<typeof setInterval> | undefined;

	function markActivity() {
		lastActivity = Date.now();
	}

	function stopSilenceWatch() {
		clearInterval(silenceTimer);
		silenceTimer = undefined;
	}

	function startSilenceWatch() {
		stopSilenceWatch();
		markActivity();
		silenceTimer = setInterval(() => {
			// Not silence: still connecting, waiting for the mic permission, or the assistant is talking.
			if (status === 'connecting' || status === 'speaking' || micPending) {
				markActivity();
				return;
			}
			if (Date.now() - lastActivity >= SILENCE_MS) {
				endSession(true);
				notice = 'La sesión terminó porque no se escuchó nada por 6 segundos. Toca el micrófono para seguir.';
			}
		}, 500);
	}

	function toggleSession() {
		if (active) endSession(true);
		else startSession();
	}

	// 16 kHz mono PCM16 capture worklet, loaded from a Blob so no extra static file is needed.
	const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) {
      const out = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = Math.max(-1, Math.min(1, ch[i])) * 0x7fff;
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', Pcm);`;

	const toBase64 = (buf: ArrayBuffer) => {
		const bytes = new Uint8Array(buf);
		let bin = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}
		return btoa(bin);
	};

	function fail(message: string) {
		error = message;
		endSession(false);
	}

	function append(role: Line['role'], text: string) {
		if (!text) return;
		if (lastRole === role && lines.length) lines[lines.length - 1].text += text;
		else lines.push({ role, text });
		lastRole = role;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function send(msg: any) {
		if (msg.type === 'state') {
			toolState.fields = msg.fields ?? {};
			return;
		}
		if (!session) return;
		try {
			if (msg.type === 'audio') session.sendRealtimeInput({ audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } });
			else if (msg.type === 'audioEnd') session.sendRealtimeInput({ audioStreamEnd: true });
			else if (msg.type === 'text') session.sendRealtimeInput({ text: String(msg.text).slice(0, 2000) });
		} catch {
			/* session already closed */
		}
	}

	// Runs the model's function calls through the app (session cookie, so roles and validation apply).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async function runToolCalls(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
		const functionResponses: { id?: string; name?: string; response: Record<string, unknown> }[] = [];
		for (const call of calls) {
			let response: Record<string, unknown>;
			try {
				const res = await fetch('/api/live/tool', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name: call.name, args: call.args ?? {}, state: toolState })
				});
				if (!res.ok) throw new Error(`tool endpoint answered ${res.status}`);
				const out = await res.json();
				response = out.response ?? { ok: true };
				if (out.fields) {
					toolState.fields = out.fields;
					onServerMessage({ type: 'intake', fields: out.fields, done: Boolean(out.done) });
				}
				if (out.openings) {
					// Remember which slots were read aloud so "number 2" maps to the right one.
					toolState.openings = out.openings.map((o: { slotId: string }) => o.slotId);
					onServerMessage({ type: 'openings', openings: out.openings });
				}
				if (out.booked) onServerMessage({ type: 'booked', code: out.booked.code });
				if (out.waiting) onServerMessage({ type: 'waiting', code: out.waiting.code });
				if (out.slots) onServerMessage({ type: 'slots', ...out.slots });
			} catch (e) {
				response = {
					ok: false,
					error: e instanceof Error ? e.message : String(e),
					instruction: 'The action failed. Apologise briefly in Spanish and ask the person to try again or use the form on the screen.'
				};
			}
			functionResponses.push({ id: call.id, name: call.name, response });
		}
		try {
			session?.sendToolResponse({ functionResponses });
		} catch {
			/* session already closed */
		}
	}

	function setIdle() {
		if (status !== 'disconnected' && status !== 'connecting') status = micOn ? 'listening' : 'live';
	}

	function playChunk(b64: string) {
		if (!outCtx) return;
		const bin = atob(b64);
		const pcm = new Int16Array(bin.length >> 1);
		for (let i = 0; i < pcm.length; i++) {
			pcm[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
		}
		const buf = outCtx.createBuffer(1, pcm.length, 24000); // Gemini replies at 24 kHz
		const f32 = buf.getChannelData(0);
		for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
		const src = outCtx.createBufferSource();
		src.buffer = buf;
		src.connect(outCtx.destination);
		playHead = Math.max(playHead, outCtx.currentTime);
		src.start(playHead);
		playHead += buf.duration;
		sources.add(src);
		src.onended = () => sources.delete(src);
		status = 'speaking';
		clearTimeout(speakingTimer);
		speakingTimer = setTimeout(setIdle, Math.max(0, (playHead - outCtx.currentTime) * 1000) + 150);
	}

	function stopPlayback() {
		for (const s of sources) {
			try {
				s.stop();
			} catch {
				/* already stopped */
			}
		}
		sources.clear();
		if (outCtx) playHead = outCtx.currentTime;
		clearTimeout(speakingTimer);
	}

	// Handles both Gemini messages (serverContent, toolCall) and the app's own events ('ready', 'intake', ...).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function onServerMessage(msg: any) {
		if (msg.toolCall?.functionCalls?.length) {
			markActivity();
			void runToolCalls(msg.toolCall.functionCalls);
			return;
		}
		// Anything the assistant sends back (speech, transcripts, results) means the conversation is alive.
		markActivity();
		if (msg.type === 'ready') {
			startSilenceWatch();
			status = micOn ? 'listening' : 'live';
			if (fields && Object.keys(fields).length) send({ type: 'state', fields: $state.snapshot(fields) });
			return;
		}
		if (msg.type === 'intake') {
			onintake?.(msg.fields ?? {}, Boolean(msg.done));
			return;
		}
		if (msg.type === 'openings') {
			onopenings?.(Array.isArray(msg.openings) ? msg.openings : []);
			return;
		}
		if (msg.type === 'booked' || msg.type === 'waiting') {
			// Let the model finish its spoken confirmation before the page changes.
			const code = String(msg.code ?? '');
			setTimeout(() => ondone?.(code), 6000);
			return;
		}
		if (msg.type === 'slots') {
			onslots?.({ summary: String(msg.summary ?? ''), added: Number(msg.added ?? 0) });
			return;
		}
		if (msg.type === 'error') {
			fail(msg.message || 'Error de conexión.');
			return;
		}
		const sc = msg.serverContent;
		if (!sc) return;
		if (sc.interrupted) {
			stopPlayback();
			setIdle();
		}
		for (const part of sc.modelTurn?.parts ?? []) {
			if (part.inlineData?.data) playChunk(part.inlineData.data);
			else if (part.text) append('assistant', part.text);
		}
		if (sc.inputTranscription?.text) append('user', sc.inputTranscription.text);
		if (sc.outputTranscription?.text) append('assistant', sc.outputTranscription.text);
		if (sc.turnComplete) lastRole = null;
	}

	async function startMic() {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('Tu navegador no permite usar el micrófono.');
		}
		micStream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		});
		const track = micStream.getAudioTracks()[0];
		micCtx = new AudioContext({ sampleRate: 16000 });
		if (micCtx.state === 'suspended') await micCtx.resume();
		const diag = {
			type: 'diag',
			track: track
				? { label: track.label, muted: track.muted, enabled: track.enabled, state: track.readyState, settings: track.getSettings() }
				: null,
			ctx: { state: micCtx.state, sampleRate: micCtx.sampleRate },
			ua: navigator.userAgent
		};
		console.info('[live] mic diagnostics', diag);
		const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
		try {
			await micCtx.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		micNode = new AudioWorkletNode(micCtx, 'pcm-capture');
		let peak = 0;
		let samples = 0;
		let warned = false;
		micNode.port.onmessage = (e) => {
			const pcm = new Int16Array(e.data);
			let chunkPeak = 0;
			for (let i = 0; i < pcm.length; i++) chunkPeak = Math.max(chunkPeak, Math.abs(pcm[i]));
			peak = Math.max(peak, chunkPeak);
			if (chunkPeak >= SPEECH_PEAK) markActivity();
			samples += pcm.length;
			// ~3 s of audio and still exactly zero: the browser is capturing silence.
			if (!warned && samples >= 16000 * 3 && peak === 0) {
				warned = true;
				error =
					'El micrófono envía silencio. Revisa que el micrófono correcto esté seleccionado y no esté silenciado en el sistema. Aún puedes escribir.';
				console.warn('[live] microphone is sending digital silence');
			}
			send({ type: 'audio', data: toBase64(e.data) });
		};
		micCtx.createMediaStreamSource(micStream).connect(micNode);
		// Some browsers only pull audio through nodes that reach the destination; a muted gain keeps the graph active without echo.
		const mute = micCtx.createGain();
		mute.gain.value = 0;
		micNode.connect(mute).connect(micCtx.destination);
		micOn = true;
	}

	function stopMic() {
		micOn = false;
		micNode?.disconnect();
		micNode = null;
		micStream?.getTracks().forEach((t) => t.stop());
		micStream = null;
		micCtx?.close().catch(() => {});
		micCtx = null;
	}

	async function startSession() {
		if (active) return;
		error = '';
		notice = '';
		status = 'connecting';
		lines = [];
		lastRole = null;
		toolState = { fields: {}, openings: [] };
		outCtx = new AudioContext({ sampleRate: 24000 });
		playHead = 0;
		const gen = ++connectGen;
		micPending = true;
		try {
			// The server checks the login and returns a one-use token with the prompt and tools locked in.
			const res = await fetch('/api/live/token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ context })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message || 'No se pudo conectar con el asistente.');
			}
			const { token, model } = (await res.json()) as { token: string; model: string };
			if (gen !== connectGen) return;
			const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
			const s = await ai.live.connect({
				model,
				config: { responseModalities: [Modality.AUDIO] },
				callbacks: {
					onmessage: (m) => {
						if (gen === connectGen) onServerMessage(m);
					},
					onerror: () => {
						if (gen === connectGen) fail('Error en la conexión con Gemini.');
					},
					onclose: () => {
						if (gen === connectGen && session) endSession(false);
					}
				}
			});
			if (gen !== connectGen) {
				s.close();
				return;
			}
			session = s;
			onServerMessage({ type: 'ready' });
		} catch (e) {
			if (gen === connectGen) {
				micPending = false;
				fail(e instanceof Error && e.message ? e.message : 'No se pudo conectar con el asistente.');
			}
			return;
		}
		try {
			await startMic();
			if (gen === connectGen && (status as Status) === 'live') status = 'listening';
		} catch (e) {
			// Mic unavailable: the session stays usable by text.
			error =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Permite el micrófono para hablar. Aún puedes escribir.'
					: 'No se pudo abrir el micrófono. Aún puedes escribir.';
		} finally {
			micPending = false;
			markActivity(); // the 6 seconds start once the mic is ready
		}
	}

	function endSession(userInitiated = true) {
		clearTimeout(speakingTimer);
		stopSilenceWatch();
		micPending = false;
		if (micOn && session) send({ type: 'audioEnd' });
		stopMic();
		stopPlayback();
		outCtx?.close().catch(() => {});
		outCtx = null;
		connectGen++;
		const closing = session;
		session = null;
		try {
			closing?.close();
		} catch {
			/* already closed */
		}
		status = 'disconnected';
	}

	function sendText(e: SubmitEvent) {
		e.preventDefault();
		const text = typed.trim();
		if (!text || !active) return;
		stopPlayback();
		markActivity();
		lastRole = null;
		append('user', text);
		lastRole = null;
		send({ type: 'text', text });
		typed = '';
	}

	// Close the socket, mic and audio output when navigating away.
	onMount(() => () => endSession(true));

	const dot: Record<Status, string> = {
		disconnected: 'bg-muted',
		connecting: 'bg-warn animate-pulse',
		live: 'bg-accent',
		listening: 'bg-accent animate-pulse',
		speaking: 'bg-mint animate-pulse'
	};
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 text-ink" aria-label="Asistente de voz en vivo">
	<div class="flex items-center justify-between gap-3">
		<h2 class="font-semibold">Asistente de voz en vivo</h2>
		<span class="flex items-center gap-2 text-sm text-muted-strong" aria-live="polite">
			<span class="size-2.5 rounded-full {dot[status]}"></span>{LABELS[status]}
		</span>
	</div>

	<div class="flex flex-col items-center gap-2 py-1">
		<button
			type="button"
			onclick={toggleSession}
			aria-label={active ? 'Terminar sesión' : 'Iniciar sesión'}
			aria-pressed={active}
			class="flex size-24 items-center justify-center rounded-full bg-accent text-white transition {active
				? 'ring-[14px] ring-mint'
				: 'ring-[10px] ring-accent-soft'} {status === 'listening' || status === 'speaking' ? 'animate-pulse' : ''}"
		>
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
		</button>
		<p class="text-sm font-medium text-muted-strong">{active ? 'Toca para terminar' : 'Toca para hablar'}</p>
		{#if active}
			<p class="text-center text-[13px] text-muted">Se cierra sola tras 6 segundos de silencio.</p>
		{:else if hint}
			<p class="text-center text-[13px] text-muted">{hint}</p>
		{/if}
	</div>

	{#if notice}
		<p class="rounded-lg bg-info-bg px-3 py-2 text-sm text-info" role="status">{notice}</p>
	{/if}

	{#if error}
		<p class="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{error}</p>
	{/if}

	{#if lines.length}
		<div class="flex max-h-48 flex-col gap-2 overflow-y-auto text-sm" aria-live="polite">
			{#each lines as l, i (i)}
				<div class={l.role === 'user' ? 'max-w-[85%] self-end rounded-2xl bg-ink px-3 py-2 text-paper' : 'max-w-[85%] self-start rounded-2xl bg-accent-soft px-3 py-2'}>{l.text}</div>
			{/each}
		</div>
	{/if}

	<form class="flex gap-2" onsubmit={sendText}>
		<label for="live-typed-{context}" class="sr-only">Escribe un mensaje</label>
		<input id="live-typed-{context}" bind:value={typed} oninput={markActivity} disabled={!active} placeholder="O escribe aquí…" class="h-11 flex-1 rounded-full border-line-strong px-4 text-ink focus:border-accent focus:ring-accent disabled:opacity-50" />
		<button disabled={!active || !typed.trim()} class="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Enviar</button>
	</form>
</section>

<script lang="ts">
	import { onMount } from 'svelte';

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
		fields,
		onintake,
		onslots
	}: {
		context?: 'nueva' | 'oficina' | 'default';
		/** Fields the page already has, so the live model doesn't ask for them again. */
		fields?: IntakeFields;
		/** The model saved patient request fields. */
		onintake?: (fields: IntakeFields, done: boolean) => void;
		/** The model published clinic slots. */
		onslots?: (result: { summary: string; added: number }) => void;
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

	let ws: WebSocket | null = null;
	let micCtx: AudioContext | null = null;
	let micStream: MediaStream | null = null;
	let micNode: AudioWorkletNode | null = null;
	let outCtx: AudioContext | null = null;
	let playHead = 0;
	const sources = new Set<AudioBufferSourceNode>();
	let micOn = false;
	let lastRole: Line['role'] | null = null;
	let speakingTimer: ReturnType<typeof setTimeout> | undefined;

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

	function send(msg: object) {
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

	function onServerMessage(ev: MessageEvent) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let msg: any;
		try {
			msg = JSON.parse(ev.data);
		} catch {
			return;
		}
		if (msg.type === 'ready') {
			status = micOn ? 'listening' : 'live';
			if (fields && Object.keys(fields).length) send({ type: 'state', fields: $state.snapshot(fields) });
			return;
		}
		if (msg.type === 'intake') {
			onintake?.(msg.fields ?? {}, Boolean(msg.done));
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
		// Sent to the server so it shows up in logs/live.log next to the audio stats.
		const diag = {
			type: 'diag',
			track: track
				? { label: track.label, muted: track.muted, enabled: track.enabled, state: track.readyState, settings: track.getSettings() }
				: null,
			ctx: { state: micCtx.state, sampleRate: micCtx.sampleRate },
			ua: navigator.userAgent
		};
		console.info('[live] mic diagnostics', diag);
		send(diag);
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
			for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
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

	function startSession() {
		if (active) return;
		error = '';
		status = 'connecting';
		lines = [];
		lastRole = null;
		outCtx = new AudioContext({ sampleRate: 24000 });
		playHead = 0;
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const socket = new WebSocket(`${proto}://${location.host}/api/live?context=${context}`);
		ws = socket;
		socket.onmessage = onServerMessage;
		socket.onerror = () => {
			if (ws === socket) fail('No se pudo conectar con el asistente.');
		};
		socket.onclose = () => {
			if (ws === socket) endSession(false);
		};
		socket.onopen = async () => {
			try {
				await startMic();
				if (ws === socket && status === 'live') status = 'listening';
			} catch (e) {
				// Mic unavailable: the session stays usable by text.
				error =
					e instanceof DOMException && e.name === 'NotAllowedError'
						? 'Permite el micrófono para hablar. Aún puedes escribir.'
						: 'No se pudo abrir el micrófono. Aún puedes escribir.';
			}
		};
	}

	function endSession(userInitiated = true) {
		clearTimeout(speakingTimer);
		if (micOn && ws?.readyState === WebSocket.OPEN) send({ type: 'audioEnd' });
		stopMic();
		stopPlayback();
		outCtx?.close().catch(() => {});
		outCtx = null;
		const socket = ws;
		ws = null;
		if (socket && socket.readyState <= WebSocket.OPEN) {
			socket.close(1000, userInitiated ? 'user' : 'error');
		}
		status = 'disconnected';
	}

	function sendText(e: SubmitEvent) {
		e.preventDefault();
		const text = typed.trim();
		if (!text || !active) return;
		stopPlayback();
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

	<div class="flex gap-2">
		<button type="button" onclick={startSession} disabled={active} class="h-11 flex-1 rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark disabled:opacity-50">Iniciar sesión</button>
		<button type="button" onclick={() => endSession(true)} disabled={!active} class="h-11 flex-1 rounded-xl border border-line-strong font-semibold disabled:opacity-50">Terminar sesión</button>
	</div>

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
		<input id="live-typed-{context}" bind:value={typed} disabled={!active} placeholder="O escribe aquí…" class="h-11 flex-1 rounded-full border-line-strong px-4 text-ink focus:border-accent focus:ring-accent disabled:opacity-50" />
		<button disabled={!active || !typed.trim()} class="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Enviar</button>
	</form>
</section>

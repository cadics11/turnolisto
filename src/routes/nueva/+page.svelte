<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import type { OpeningCard } from '#lib/types.ts';
	import Logo from '#lib/components/Logo.svelte';
	import LiveAssistant from '#lib/components/LiveAssistant.svelte';
	import { VoiceInput, speak, stopSpeaking } from '#lib/voice.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Msg = { role: 'user' | 'assistant'; text: string };
	type Fields = {
		specialty?: string;
		town?: string;
		region?: string;
		plan?: string;
		preferredDays?: string;
		hasReferral?: boolean;
	};

	const GREETING =
		'¡Hola! Dime qué especialista necesitas, en qué pueblo o área, y qué plan médico tienes.';

	let messages = $state<Msg[]>([{ role: 'assistant', text: GREETING }]);
	let fields = $state<Fields>({});
	let lastAsked = $state<string | null>(null);
	let done = $state(false);
	let busy = $state(false);
	let typed = $state('');
	let showTextBox = $state(false);
	let speakReplies = $state(true);
	let chatEl: HTMLDivElement | undefined = $state();
	let openings = $state<OpeningCard[]>([]);
	let loadingOpenings = $state(false);

	// Once the request is complete, look for up to 3 openings the patient can pick from.
	let searchedFor = '';
	$effect(() => {
		if (!done) {
			openings = [];
			searchedFor = '';
			return;
		}
		const key = JSON.stringify(fields);
		if (key === searchedFor) return;
		searchedFor = key;
		void loadOpenings();
	});

	async function loadOpenings() {
		loadingOpenings = true;
		try {
			const res = await fetch('/api/openings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fields: $state.snapshot(fields) })
			});
			openings = res.ok ? (await res.json()).openings : [];
		} catch {
			openings = [];
		} finally {
			loadingOpenings = false;
		}
	}

	const voice = new VoiceInput((text) => send(text));

	async function send(text: string) {
		const clean = text.trim();
		if (!clean || busy) return;
		messages.push({ role: 'user', text: clean });
		busy = true;
		await scrollDown();
		try {
			const res = await fetch('/api/intake', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages, fields, lastAsked })
			});
			const r = await res.json();
			fields = r.fields;
			lastAsked = r.nextAsk;
			done = r.done;
			messages.push({ role: 'assistant', text: r.reply });
			if (speakReplies) speak(r.reply);
		} catch {
			messages.push({ role: 'assistant', text: 'Hubo un problema de conexión. Intenta otra vez.' });
		} finally {
			busy = false;
			await scrollDown();
		}
	}

	async function scrollDown() {
		await tick();
		chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
	}

	function restart() {
		stopSpeaking();
		messages = [{ role: 'assistant', text: GREETING }];
		fields = {};
		lastAsked = null;
		done = false;
	}

	const cards = $derived([
		{ label: 'Especialidad', value: fields.specialty },
		{
			label: 'Área',
			value: fields.region ? (fields.town ? `${fields.town} · ${fields.region}` : fields.region) : undefined
		},
		{ label: 'Plan médico', value: fields.plan },
		{ label: 'Días', value: fields.preferredDays },
		{
			label: 'Referido',
			value: fields.hasReferral === undefined ? undefined : fields.hasReferral ? 'Sí, lo tengo' : 'Todavía no'
		}
	]);
</script>

<main class="mx-auto flex min-h-[calc(100dvh-44px)] max-w-md flex-col gap-4 px-5 pt-5 pb-7">
	<div class="flex items-center justify-between">
		<Logo />
		{#if !data.liveEnabled}
			<label class="flex min-h-11 items-center gap-2 text-sm text-muted">
				<input type="checkbox" bind:checked={speakReplies} class="rounded text-accent focus:ring-accent" />
				Leer respuestas en voz alta
			</label>
		{/if}
	</div>

	<h1 class="font-display text-[30px] leading-tight font-bold tracking-tight">
		¿Qué especialista necesitas?
	</h1>

	{#if !data.liveEnabled}
	<div bind:this={chatEl} class="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
		{#each messages as m, i (i)}
			{#if m.role === 'user'}
				<div class="max-w-[85%] self-end rounded-[18px] rounded-br-[4px] bg-ink px-3.5 py-3 text-base leading-snug text-paper">
					{m.text}
				</div>
			{:else}
				<div class="max-w-[85%] self-start rounded-[18px] rounded-bl-[4px] border border-line bg-white px-3.5 py-3 text-base leading-snug">
					{m.text}
				</div>
			{/if}
		{/each}
		{#if voice.interim}
			<div class="max-w-[85%] self-end rounded-[18px] rounded-br-[4px] bg-ink/70 px-3.5 py-3 text-base text-paper italic">
				{voice.interim}
			</div>
		{/if}
		{#if busy}
			<div class="self-start rounded-[18px] border border-line bg-white px-3.5 py-3 text-sm text-muted">Pensando…</div>
		{/if}
	</div>
	{/if}

	<section class="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Tu solicitud">
		<div class="flex items-center justify-between">
			<h2 class="text-[15px] font-semibold">Tu solicitud</h2>
			<span class="text-[13px] text-muted">Se completa mientras hablas</span>
		</div>
		<div class="grid grid-cols-2 gap-2">
			{#each cards as c (c.label)}
				{#if c.value}
					<div class="rounded-[10px] bg-accent-soft p-2.5">
						<div class="text-xs text-muted-strong">{c.label}</div>
						<div class="text-[15px] font-semibold">{c.value}</div>
					</div>
				{:else}
					<div class="rounded-[10px] border border-dashed border-line-strong bg-paper p-2.5">
						<div class="text-xs text-muted">{c.label}</div>
						<div class="text-[15px] font-semibold text-muted">Pendiente…</div>
					</div>
				{/if}
			{/each}
		</div>
		<p class="flex items-start gap-2 text-[13px] leading-snug text-muted-strong">
			<svg class="mt-0.5 flex-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
			<span>No guardamos tu diagnóstico. Tu nombre y teléfono no se comparten hasta que aceptes un turno.</span>
		</p>
	</section>

	{#if data.liveEnabled}
	<LiveAssistant
		context="nueva"
		hint="Dime qué especialista necesitas, en qué pueblo y qué plan médico tienes."
		{fields}
		onintake={(f, isDone) => {
			fields = f;
			done = isDone;
		}}
		onopenings={(list) => (openings = list)}
		ondone={(code) => goto(`/solicitud/${code}`)}
	/>
	{/if}

	{#if done}
		<section class="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4" aria-label="Turnos disponibles">
			{#if loadingOpenings}
				<p class="text-sm text-muted">Buscando turnos…</p>
			{:else if openings.length}
				<h2 class="text-[15px] font-semibold">Turnos disponibles ({openings.length})</h2>
				<p class="text-[13px] text-muted">Escoge uno. También puedes decirlo con la voz: “el número 2”.</p>
				{#each openings as o, i (o.slotId)}
					<form method="POST" action="?/book" use:enhance class="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
						<input type="hidden" name="fields" value={JSON.stringify(fields)} />
						<input type="hidden" name="slot" value={o.slotId} />
						<div class="min-w-0">
							<div class="text-[13px] font-semibold text-accent">Opción {i + 1}{o.distance ? ` · ${o.distance}` : ''}</div>
							<div class="font-semibold">{o.clinic}</div>
							<div class="text-[13px] text-muted capitalize">{o.when}</div>
							<div class="text-[13px] text-muted">{o.address}, {o.town}</div>
						</div>
						<button class="h-11 flex-none rounded-xl bg-accent px-4 font-semibold text-white hover:bg-accent-dark">Reservar</button>
					</form>
				{/each}
			{:else}
				<h2 class="text-[15px] font-semibold">No hay turnos abiertos ahora</h2>
				<p class="text-[13px] leading-snug text-muted">
					Te ponemos en la lista de espera. En cuanto se abra un turno que coincida, {data.smsAlerts ? 'te avisamos por SMS' : 'lo verás aquí en la app'} y lo reservas.
				</p>
			{/if}

			{#if form?.message}
				<p class="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{form.message}</p>
			{/if}

			{#if !loadingOpenings}
				<form method="POST" action="?/wait" use:enhance>
					<input type="hidden" name="fields" value={JSON.stringify(fields)} />
					<button class="h-12 w-full rounded-xl {openings.length ? 'border border-line-strong font-semibold' : 'bg-accent font-semibold text-white hover:bg-accent-dark'}">
						{openings.length ? 'Ninguno me sirve: avisarme de otros' : 'Ponerme en la lista de espera'}
					</button>
				</form>
			{/if}
			<button type="button" onclick={restart} class="min-h-11 text-sm font-medium text-accent">Empezar de nuevo</button>
		</section>
	{:else if !data.liveEnabled}
		<div class="flex-1"></div>
		<div class="flex flex-col items-center gap-3">
			{#if voice.supported}
				<p class="text-sm text-muted-strong" aria-live="polite">
					{voice.listening ? 'Escuchando…' : voice.error || 'Toca el micrófono para hablar'}
				</p>
				<button
					type="button"
					onclick={() => voice.toggle()}
					disabled={busy}
					aria-label={voice.listening ? 'Dejar de escuchar' : 'Hablar'}
					aria-pressed={voice.listening}
					class="flex size-24 items-center justify-center rounded-full bg-accent text-white transition disabled:opacity-50 {voice.listening ? 'ring-[14px] ring-mint animate-pulse' : 'ring-[10px] ring-accent-soft'}"
				>
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
				</button>
			{:else}
				<p class="text-center text-sm text-muted">Tu navegador no permite dictado por voz. Usa Chrome, o escribe abajo.</p>
			{/if}

			{#if showTextBox || !voice.supported}
				<form
					class="flex w-full gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						send(typed);
						typed = '';
					}}
				>
					<label for="typed" class="sr-only">Escribe tu mensaje</label>
					<input id="typed" bind:value={typed} placeholder="Ej: Necesito un ortodoncista en Arecibo, tengo Triple-S" class="h-11 flex-1 rounded-full border-line-strong px-4 focus:border-accent focus:ring-accent" />
					<button aria-label="Enviar" disabled={busy} class="flex size-11 items-center justify-center rounded-full bg-accent text-white disabled:opacity-50">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
					</button>
				</form>
			{:else}
				<button type="button" onclick={() => (showTextBox = true)} class="min-h-11 text-[15px] font-medium text-accent hover:text-accent-dark">Prefiero escribir</button>
			{/if}
		</div>
	{/if}
</main>

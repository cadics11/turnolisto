<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Logo from '#lib/components/Logo.svelte';
	import LiveAssistant from '#lib/components/LiveAssistant.svelte';
	import { formatPhone, formatSlot } from '#lib/constants.ts';
	import { VoiceInput } from '#lib/voice.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editingPlans = $state(false);
	let voiceText = $state('');
	let voiceForm: HTMLFormElement | undefined = $state();

	const voice = new VoiceInput((text) => {
		voiceText = text;
		queueMicrotask(() => voiceForm?.requestSubmit());
	});

	const tomorrow = (() => {
		const d = new Date();
		d.setDate(d.getDate() + 1);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	})();

	$effect(() => {
		const t = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(t);
	});

	function minutesLeft(iso: string | null) {
		if (!iso) return 0;
		return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
	}

	const statusStyle = {
		open: 'bg-info-bg text-info',
		offered: 'bg-warn-bg text-warn',
		booked: 'bg-accent-soft text-[#1E4A40]'
	} as const;
</script>

<svelte:head><title>Oficina · TurnoListo</title></svelte:head>

<header class="border-b border-line bg-white">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-3.5">
		<div class="flex flex-wrap items-center gap-4">
			<Logo />
			<span class="text-sm font-semibold">{data.clinic.name}</span>
			<span class="text-sm text-muted">{data.clinic.specialty} · {data.clinic.town} ({data.clinic.region})</span>
		</div>
		<div class="flex items-center gap-3">
			<span class="text-sm text-muted">@{data.username}</span>
			<form method="POST" action="/logout">
				<button class="min-h-10 rounded-lg border border-line-strong px-3 text-sm font-semibold">Salir</button>
			</form>
		</div>
	</div>
</header>

<main class="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-7 pb-10">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-[34px] font-bold tracking-tight">Turnos disponibles</h1>
			<p class="mt-1 text-[15px] text-muted">Publica tus huecos al final del día. TurnoListo encuentra al paciente.</p>
		</div>

		{#if editingPlans}
			<form method="POST" action="?/plans" use:enhance={() => async ({ update }) => { await update({ reset: false }); editingPlans = false; }} class="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
				<span class="text-[13px] text-muted">Planes aceptados:</span>
				{#each data.allPlans as p (p)}
					<label class="flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold">
						<input type="checkbox" name="plans" value={p} checked={data.clinic.acceptedPlans.includes(p)} class="rounded text-accent focus:ring-accent" />
						{p}
					</label>
				{/each}
				<button class="h-9 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white">Guardar</button>
			</form>
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-[13px] text-muted">Planes aceptados:</span>
				{#each data.clinic.acceptedPlans as p (p)}
					<span class="rounded-full bg-accent-soft px-2.5 py-1.5 text-[13px] font-semibold text-[#23413A]">{p}</span>
				{:else}
					<span class="text-[13px] text-danger">Ninguno</span>
				{/each}
				<button type="button" onclick={() => (editingPlans = true)} class="min-h-11 px-1 text-[13px] font-semibold text-accent">Editar</button>
			</div>
		{/if}
	</div>

	{#if form?.message}
		<p class="rounded-xl bg-accent-soft px-4 py-3 text-sm font-medium text-[#23413A]" role="status">{form.message}</p>
	{/if}

	<div class="flex flex-wrap items-start gap-6">
		<div class="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
			<section class="flex flex-col gap-3.5 rounded-[18px] bg-ink p-5 text-paper">
				<h2 class="font-semibold">Abrir turnos por voz</h2>
				<div class="flex items-center gap-3.5">
					<button
						type="button"
						onclick={() => voice.toggle()}
						disabled={!voice.supported}
						aria-label={voice.listening ? 'Dejar de escuchar' : 'Hablar'}
						aria-pressed={voice.listening}
						class="flex size-14 flex-none items-center justify-center rounded-full bg-mint text-ink disabled:opacity-40 {voice.listening ? 'animate-pulse ring-4 ring-white/40' : ''}"
					>
						<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
					</button>
					<p class="text-[15px] leading-snug text-paper/85">
						{voice.interim || (voice.listening ? 'Escuchando…' : '“Abre tres turnos el martes de 2 a 4.”')}
					</p>
				</div>
				<form bind:this={voiceForm} method="POST" action="?/voice" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="flex gap-2">
					<label for="voice-text" class="sr-only">Comando</label>
					<input id="voice-text" name="text" bind:value={voiceText} placeholder="O escribe el comando aquí" class="h-11 flex-1 rounded-lg border-0 bg-white/10 text-paper placeholder:text-paper/60 focus:ring-mint" />
					<button class="h-11 rounded-lg bg-white/15 px-4 text-sm font-semibold">Enviar</button>
				</form>
				{#if !data.aiEnabled}
					<p class="text-xs text-paper/60">Modo sin IA: entiende frases simples. Añade LLM_API_KEY para más flexibilidad.</p>
				{/if}
			</section>

			<LiveAssistant context="oficina" onslots={() => invalidateAll()} />

			<form method="POST" action="?/publish" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="flex flex-col gap-3.5 rounded-[18px] border border-line bg-white p-5">
				<h2 class="font-semibold">O hazlo a mano</h2>
				<div class="flex flex-col gap-1.5">
					<label for="f-date" class="text-[13px] font-semibold text-muted-strong">Fecha</label>
					<input id="f-date" name="date" type="date" value={tomorrow} required class="h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent" />
				</div>
				<div class="grid grid-cols-2 gap-2.5">
					<div class="flex flex-col gap-1.5">
						<label for="f-from" class="text-[13px] font-semibold text-muted-strong">Desde</label>
						<input id="f-from" name="from" type="time" value="14:00" required class="h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="f-to" class="text-[13px] font-semibold text-muted-strong">Hasta</label>
						<input id="f-to" name="to" type="time" value="16:00" required class="h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent" />
					</div>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="f-len" class="text-[13px] font-semibold text-muted-strong">Duración de cada turno</label>
					<select id="f-len" name="duration" class="h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent">
						<option value="20">20 minutos</option>
						<option value="30">30 minutos</option>
						<option value="40" selected>40 minutos</option>
						<option value="60">60 minutos</option>
					</select>
				</div>
				<p class="text-[13px] text-muted">Se usarán tus planes aceptados.</p>
				<button class="h-12 rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark">Publicar turnos</button>
			</form>

			<section class="rounded-[18px] border border-line bg-white p-5 text-sm leading-relaxed">
				<h2 class="mb-1 font-semibold">Demanda en tu área</h2>
				<p><b>{data.waitingMatching}</b> paciente(s) esperando {data.clinic.specialty.toLowerCase()} en {data.clinic.region} con un plan que aceptas.</p>
				{#if data.waitingOtherPlans}
					<p class="mt-1 text-muted">{data.waitingOtherPlans} más esperan con planes que no aceptas.</p>
				{/if}
			</section>
		</div>

		<div class="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
			<div class="grid grid-cols-3 gap-3">
				<div class="rounded-[14px] border border-line bg-white p-4"><div class="text-[13px] text-muted">Abiertos</div><div class="font-display text-[32px] font-bold">{data.stats.open}</div></div>
				<div class="rounded-[14px] border border-line bg-white p-4"><div class="text-[13px] text-muted">Ofrecidos</div><div class="font-display text-[32px] font-bold">{data.stats.offered}</div></div>
				<div class="rounded-[14px] border border-line bg-white p-4"><div class="text-[13px] text-muted">Reservados</div><div class="font-display text-[32px] font-bold">{data.stats.booked}</div></div>
			</div>

			<section class="overflow-x-auto rounded-[18px] border border-line bg-white" aria-label="Turnos">
				<div class="min-w-[560px]">
					<div class="grid grid-cols-[150px_1fr_230px] gap-3 border-b border-[#ECEDE7] px-5 py-3.5 text-xs font-semibold tracking-wider text-muted uppercase">
						<div>Turno</div><div>Paciente</div><div>Estado</div>
					</div>
					{#each data.slots as s (s.id)}
						{@const f = formatSlot(s.startsAt)}
						<div class="grid grid-cols-[150px_1fr_230px] items-center gap-3 border-b border-[#ECEDE7] px-5 py-4 text-[15px]">
							<div><div class="font-semibold">{f.time}</div><div class="text-[13px] text-muted capitalize">{f.day} · {s.durationMin} min</div></div>
							<div>
								{#if s.patient}
									<div class="font-medium">{s.patient.name}</div>
									<div class="text-[13px] text-muted">{formatPhone(s.patient.phone)} · {s.patient.plan} · {s.patient.hasReferral ? 'con referido' : 'sin referido'}</div>
								{:else if s.status === 'offered'}
									<span class="text-muted">Oculto hasta que confirme</span>
								{:else}
									<span class="text-muted">—</span>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<span class="rounded-full px-2.5 py-1.5 text-[13px] font-semibold {statusStyle[s.status]}">
									{s.status === 'open' ? 'Abierto · buscando' : s.status === 'offered' ? `Ofrecido · ${minutesLeft(s.offerExpiresAt)} min` : 'Reservado'}
								</span>
								{#if s.status === 'open'}
									<form method="POST" action="?/remove" use:enhance>
										<input type="hidden" name="slot" value={s.id} />
										<button aria-label="Quitar turno" class="flex size-9 items-center justify-center rounded-full text-muted hover:bg-paper hover:text-danger">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
										</button>
									</form>
								{/if}
							</div>
						</div>
					{:else}
						<p class="px-5 py-8 text-center text-muted">No hay turnos publicados. Abre algunos a la izquierda.</p>
					{/each}
					<p class="px-5 py-3.5 text-[13px] leading-relaxed text-muted">
						Los pacientes se asignan en orden de espera. Verás el nombre y teléfono solo después de que el paciente confirme por SMS.
					</p>
				</div>
			</section>
		</div>
	</div>
</main>

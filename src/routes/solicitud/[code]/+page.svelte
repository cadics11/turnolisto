<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Logo from '#lib/components/Logo.svelte';
	import { formatSlot } from '#lib/constants.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.request);

	// Refresh every 4 s so the page updates live during the demo.
	$effect(() => {
		const t = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(t);
	});

	const rows = $derived([
		['Especialidad', r.specialty],
		['Área', r.town ? `${r.town} · ${r.region}` : r.region],
		['Plan médico', r.plan],
		['Días', r.preferredDays],
		['Referido', r.hasReferral ? 'Sí, lo tengo' : 'Todavía no']
	]);
</script>

<svelte:head><title>Solicitud {r.code} · TurnoListo</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100dvh-44px)] max-w-md flex-col gap-4 px-5 pt-5 pb-7">
	<div class="flex items-center justify-between">
		<Logo />
		<span class="text-[13px] text-muted">#{r.code}</span>
	</div>

	<section class="flex flex-col gap-3.5 rounded-[20px] bg-ink px-5 py-6 text-paper">
		{#if r.status === 'waiting'}
			<div class="flex items-center gap-2 text-sm font-semibold text-mint">
				<span class="size-2.5 rounded-full bg-mint"></span> En espera de un turno
			</div>
			<div class="font-display text-[44px] leading-none font-bold tracking-tight">#{data.position} en la fila</div>
			<p class="text-[15px] leading-relaxed text-paper/85">
				Cuando una oficina abra un turno que acepte tu plan, te avisamos por SMS al número que termina en {r.phoneLast4}. Tendrás 30 minutos para aceptarlo.
			</p>
		{:else if r.status === 'offered' && data.slot}
			<div class="flex items-center gap-2 text-sm font-semibold text-[#F6D58A]">
				<span class="size-2.5 rounded-full bg-[#F6D58A]"></span> Tienes un turno ofrecido
			</div>
			<div class="font-display text-[30px] leading-tight font-bold tracking-tight capitalize">{formatSlot(data.slot.startsAt).full}</div>
			<p class="text-[15px] leading-relaxed text-paper/85">
				Revisa tu SMS y responde <b>SÍ</b> para reservarlo antes de las {formatSlot(data.slot.expiresAt!).time}.
			</p>
		{:else if r.status === 'booked' && data.slot}
			<div class="flex items-center gap-2 text-sm font-semibold text-mint">
				<span class="size-2.5 rounded-full bg-mint"></span> Cita confirmada
			</div>
			<div class="font-display text-[30px] leading-tight font-bold tracking-tight capitalize">{formatSlot(data.slot.startsAt).full}</div>
			<p class="text-[15px] leading-relaxed text-paper/85">{data.slot.clinic}<br />{data.slot.address}</p>
		{:else}
			<div class="font-display text-[30px] font-bold">Solicitud cancelada</div>
		{/if}
	</section>

	<section class="rounded-2xl border border-line bg-white px-4 py-1" aria-label="Detalles">
		{#each rows as [k, v], i (k)}
			<div class="flex justify-between gap-4 py-3 text-[15px] {i < rows.length - 1 ? 'border-b border-[#ECEDE7]' : ''}">
				<span class="text-muted">{k}</span><span class="text-right font-semibold">{v}</span>
			</div>
		{/each}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="text-[15px] font-semibold">Lo que ve la oficina</h2>
		<p class="rounded-xl bg-accent-soft px-3.5 py-3 text-sm leading-relaxed text-[#23413A]">
			{#if r.status === 'booked'}
				Ahora la oficina ve tu nombre y teléfono para confirmar la cita. Nunca ve un diagnóstico.
			{:else}
				Solo: <b>{r.specialty} · {r.region} · {r.plan}</b>. Tu nombre y teléfono se comparten únicamente cuando aceptas un turno.
			{/if}
		</p>
	</section>

	<div class="flex-1"></div>

	<div class="flex gap-2.5">
		<a href="/paciente" class="flex h-12 flex-1 items-center justify-center rounded-xl border border-line-strong bg-white font-semibold text-ink">Mis solicitudes</a>
		{#if r.status === 'waiting' || r.status === 'offered'}
			<form method="POST" action="?/cancel" use:enhance class="flex flex-1">
				<button class="h-12 flex-1 rounded-xl bg-danger-bg font-semibold text-danger">Cancelar solicitud</button>
			</form>
		{/if}
	</div>
</main>

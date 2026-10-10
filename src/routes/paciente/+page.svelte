<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Logo from '#lib/components/Logo.svelte';
	import { formatSlot } from '#lib/constants.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	$effect(() => {
		const t = setInterval(() => invalidateAll(), 5000);
		return () => clearInterval(t);
	});

	const label = {
		waiting: 'En espera',
		offered: 'Turno ofrecido',
		booked: 'Cita confirmada',
		cancelled: 'Cancelada'
	} as const;
	const style = {
		waiting: 'bg-info-bg text-info',
		offered: 'bg-warn-bg text-warn',
		booked: 'bg-accent-soft text-[#1E4A40]',
		cancelled: 'bg-paper text-muted'
	} as const;
</script>

<svelte:head><title>Mis solicitudes · TurnoListo</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100dvh-44px)] max-w-md flex-col gap-4 px-5 pt-5 pb-7">
	<Logo />
	<h1 class="font-display text-[30px] leading-tight font-bold tracking-tight">Mis solicitudes</h1>

	{#each data.requests as r (r.code)}
		<a href="/solicitud/{r.code}" class="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 hover:border-line-strong">
			<div class="flex items-center justify-between gap-2">
				<span class="font-semibold">{r.specialty} · {r.region}</span>
				<span class="rounded-full px-2.5 py-1 text-xs font-semibold {style[r.status]}">{label[r.status]}</span>
			</div>
			<div class="text-[13px] text-muted">#{r.code} · {r.plan}</div>
			{#if r.position}
				<div class="text-sm font-medium">#{r.position} en la fila</div>
			{:else if r.appointment}
				<div class="text-sm font-medium capitalize">{formatSlot(r.appointment.startsAt).full} · {r.appointment.clinic}</div>
			{/if}
		</a>
	{:else}
		<p class="rounded-2xl border border-dashed border-line-strong p-6 text-center text-muted">
			Todavía no has pedido ningún especialista.
		</p>
	{/each}

	<div class="flex-1"></div>
	<a href="/nueva" class="flex h-12 items-center justify-center rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark">Pedir un especialista</a>
</main>

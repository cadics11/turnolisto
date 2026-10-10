<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { formatPhone } from '#lib/constants.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let threadEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		const t = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(t);
	});

	$effect(() => {
		data.messages.length;
		tick().then(() => threadEl?.scrollTo({ top: threadEl.scrollHeight }));
	});

	const time = (iso: string) =>
		new Date(iso).toLocaleTimeString('es-PR', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Puerto_Rico' });
</script>

<svelte:head><title>Mis mensajes · TurnoListo</title></svelte:head>

<main class="mx-auto flex max-w-5xl flex-col gap-4 px-4 pt-6 pb-10">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-[30px] font-bold tracking-tight">Mis mensajes</h1>
			<p class="text-sm text-muted">Los mensajes de texto de TurnoListo a tu teléfono. Con SMS_MODE=simulated, responde aquí en vez de por celular.</p>
		</div>
	</div>

	{#if form?.message}<p class="rounded-lg bg-accent-soft px-3 py-2 text-sm" role="status">{form.message}</p>{/if}

	<div class="flex flex-wrap gap-4">
		<nav aria-label="Conversaciones" class="flex min-w-0 flex-[1_1_220px] flex-col gap-1 self-start rounded-2xl border border-line bg-white p-2">
			{#each data.threads as t (t.phone)}
				<a
					href="?p={t.phone}"
					data-sveltekit-noscroll
					class="flex min-h-12 flex-col justify-center rounded-xl px-3 py-2 {t.phone === data.selected ? 'bg-accent-soft' : 'hover:bg-paper'}"
				>
					<span class="text-sm font-semibold">{t.name}</span>
					<span class="text-xs text-muted">{formatPhone(t.phone)} · {t.count} mensajes</span>
				</a>
			{:else}
				<p class="p-3 text-sm text-muted">Todavía no tienes mensajes. Te escribiremos cuando una oficina abra un turno para ti.</p>
			{/each}
		</nav>

		<section class="flex min-h-[560px] min-w-0 flex-[3_1_400px] flex-col overflow-hidden rounded-2xl border border-line bg-white" aria-label="Conversación">
			{#if data.selected}
				<div class="flex flex-col items-center gap-1 border-b border-[#ECEDE7] px-5 py-4">
					<div class="flex size-11 items-center justify-center rounded-full bg-accent font-display font-bold text-white">TL</div>
					<div class="text-[15px] font-semibold">TurnoListo → {data.selectedName}</div>
					<div class="text-xs text-muted">{formatPhone(data.selected)} · SMS</div>
				</div>

				<div bind:this={threadEl} class="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-paper p-4" aria-live="polite">
					{#each data.messages as m (m.id)}
						{#if m.direction === 'out'}
							<div class="max-w-[80%] self-start rounded-[18px] rounded-bl-[4px] border border-line bg-white px-3.5 py-3 text-[15px] leading-snug">
								{m.body}
								<div class="mt-1 text-[11px] text-muted">{time(m.createdAt)}</div>
							</div>
						{:else}
							<div class="max-w-[80%] self-end rounded-[18px] rounded-br-[4px] bg-accent px-3.5 py-3 text-[15px] leading-snug text-white">
								{m.body}
								<div class="mt-1 text-[11px] text-white/75">{time(m.createdAt)}</div>
							</div>
							{#if m.aiNote}
								<div class="flex items-center gap-1.5 self-center rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-[#23413A]">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></svg>
									IA entendió: {m.aiNote}
								</div>
							{/if}
						{/if}
					{/each}
				</div>

				<form method="POST" action="?/reply" use:enhance class="flex gap-2.5 border-t border-[#ECEDE7] p-3">
					<input type="hidden" name="phone" value={data.selected} />
					<label for="sms-body" class="sr-only">Mensaje</label>
					<input id="sms-body" name="body" required autocomplete="off" placeholder="Ej: sí, o: sí pero a las 2 no puedo" class="h-11 flex-1 rounded-full border-line-strong px-4 focus:border-accent focus:ring-accent" />
					<button aria-label="Enviar" class="flex size-11 items-center justify-center rounded-full bg-accent text-white">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
					</button>
				</form>
			{:else}
				<p class="m-auto p-8 text-center text-muted">Selecciona una conversación.</p>
			{/if}
		</section>
	</div>
</main>

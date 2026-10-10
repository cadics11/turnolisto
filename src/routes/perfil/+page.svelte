<script lang="ts">
	import { enhance } from '$app/forms';
	import Logo from '#lib/components/Logo.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const field = 'h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent';
	const label = 'text-[13px] font-semibold text-muted-strong';

	// Only the starting values matter: after that the inputs are edited (or filled by "Usar mi ubicación").
	// svelte-ignore state_referenced_locally
	let lat = $state(String(form?.lat ?? data.profile.lat ?? ''));
	// svelte-ignore state_referenced_locally
	let lng = $state(String(form?.lng ?? data.profile.lng ?? ''));
	let locating = $state(false);
	let locError = $state('');

	function useMyLocation() {
		locError = '';
		if (!navigator.geolocation) {
			locError = 'Tu navegador no permite obtener la ubicación.';
			return;
		}
		locating = true;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				lat = pos.coords.latitude.toFixed(5);
				lng = pos.coords.longitude.toFixed(5);
				locating = false;
			},
			() => {
				locError = 'No pudimos obtener tu ubicación. Permite el acceso o escribe las coordenadas.';
				locating = false;
			},
			{ enableHighAccuracy: false, timeout: 10000 }
		);
	}
</script>

<svelte:head><title>Mi perfil · TurnoListo</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100dvh-44px)] max-w-md flex-col gap-4 px-5 pt-5 pb-7">
	<Logo />
	<div>
		<h1 class="font-display text-[30px] leading-tight font-bold tracking-tight">Mi perfil</h1>
		<p class="mt-1 text-[15px] text-muted">@{data.username}</p>
		{#if data.next}
			<p class="mt-2 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-[#23413A]">
				Completa tu nombre y teléfono para poder pedir un especialista.
			</p>
		{/if}
	</div>

	<form method="POST" action="?/save" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
		<div class="flex flex-col gap-1.5">
			<label for="name" class={label}>Tu nombre</label>
			<input id="name" name="name" required maxlength="40" autocomplete="given-name" value={form?.name ?? data.profile.name} class={field} />
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="phone" class={label}>Teléfono</label>
			<input id="phone" name="phone" type="tel" required inputmode="tel" placeholder="787-555-0123" autocomplete="tel" value={form?.phone ?? data.profile.phone} class={field} />
		</div>
		<label class="flex min-h-11 items-start gap-2.5 text-[15px]">
			<input type="checkbox" name="smsAlerts" checked={form?.smsAlerts ?? data.profile.smsAlerts} class="mt-1 rounded text-accent focus:ring-accent" />
			<span>
				<b>Quiero alertas por SMS</b>
				<span class="block text-[13px] text-muted">Te avisamos cuando se abra un turno. Si lo desactivas, verás los turnos solo en la app.</span>
			</span>
		</label>

		<fieldset class="flex flex-col gap-2">
			<legend class={label}>Mi ubicación actual</legend>
			<p class="text-[13px] text-muted">Se usa para calcular a cuántas millas está cada oficina. Solo es aproximado y nunca se comparte con las oficinas.</p>
			<div class="grid grid-cols-2 gap-2.5">
				<div class="flex flex-col gap-1.5">
					<label for="lat" class="text-xs text-muted">Latitud</label>
					<input id="lat" name="lat" inputmode="decimal" placeholder="18.4655" bind:value={lat} class={field} />
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="lng" class="text-xs text-muted">Longitud</label>
					<input id="lng" name="lng" inputmode="decimal" placeholder="-66.1057" bind:value={lng} class={field} />
				</div>
			</div>
			<button type="button" onclick={useMyLocation} disabled={locating} class="min-h-11 rounded-xl border border-line-strong font-semibold disabled:opacity-50">
				{locating ? 'Buscando…' : 'Usar mi ubicación'}
			</button>
			{#if locError}<p class="text-sm text-danger" role="alert">{locError}</p>{/if}
		</fieldset>

		{#if form?.message}
			<p class="rounded-lg px-3 py-2 text-sm {form.saved ? 'bg-accent-soft text-[#23413A]' : 'bg-danger-bg text-danger'}" role={form.saved ? 'status' : 'alert'}>{form.message}</p>
		{/if}
		<button class="h-12 rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark">Guardar</button>
	</form>

	<div class="flex-1"></div>
	<div class="flex gap-2.5">
		<a href="/paciente" class="flex h-12 flex-1 items-center justify-center rounded-xl border border-line-strong bg-white font-semibold text-ink">Mis solicitudes</a>
		<a href="/nueva" class="flex h-12 flex-1 items-center justify-center rounded-xl bg-ink font-semibold text-paper">Pedir un especialista</a>
	</div>
</main>

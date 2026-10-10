<script lang="ts">
	import { enhance } from '$app/forms';
	import Logo from '#lib/components/Logo.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const field = 'h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent';
	const label = 'text-[13px] font-semibold text-muted-strong';

	let lat = $state('');
	let lng = $state('');
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
				locError = 'No pudimos obtener la ubicación. Escribe las coordenadas.';
				locating = false;
			},
			{ timeout: 10000 }
		);
	}
</script>

<svelte:head><title>Registrar oficina · TurnoListo</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-5 px-5 py-8">
	<Logo size="text-[28px]" />
	<div>
		<h1 class="font-display text-[30px] leading-tight font-bold tracking-tight">Registra tu oficina</h1>
		<p class="mt-2 text-[15px] text-muted">
			Escoge un usuario para entrar. No hay contraseña: guarda bien tu usuario.
		</p>
	</div>

	<form method="POST" use:enhance class="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4">
		<div class="flex flex-col gap-1.5">
			<label for="username" class={label}>Usuario</label>
			<input id="username" name="username" required autocapitalize="none" spellcheck="false" autocomplete="username" value={form?.username ?? ''} class={field} />
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="name" class={label}>Nombre de la oficina</label>
			<input id="name" name="name" required maxlength="80" value={form?.name ?? ''} class={field} />
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="specialty" class={label}>Especialidad</label>
			<select id="specialty" name="specialty" required class={field}>
				<option value="">Escoge…</option>
				{#each data.specialties as s (s)}<option value={s}>{s}</option>{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="town" class={label}>Pueblo</label>
			<select id="town" name="town" required class={field}>
				<option value="">Escoge…</option>
				{#each data.towns as t (t.key)}<option value={t.key}>{t.label}</option>{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="address" class={label}>Dirección</label>
			<input id="address" name="address" required maxlength="120" value={form?.address ?? ''} class={field} />
		</div>
		<fieldset class="flex flex-col gap-2">
			<legend class={label}>Ubicación de la oficina (opcional)</legend>
			<p class="text-[13px] text-muted">Con las coordenadas calculamos a cuántas millas está cada paciente. Si no las pones, usamos el centro del pueblo.</p>
			<div class="grid grid-cols-2 gap-2.5">
				<input name="lat" inputmode="decimal" placeholder="Latitud 18.4655" aria-label="Latitud" bind:value={lat} class={field} />
				<input name="lng" inputmode="decimal" placeholder="Longitud -66.1057" aria-label="Longitud" bind:value={lng} class={field} />
			</div>
			<button type="button" onclick={useMyLocation} disabled={locating} class="min-h-11 rounded-xl border border-line-strong text-sm font-semibold disabled:opacity-50">
				{locating ? 'Buscando…' : 'Usar la ubicación de este dispositivo'}
			</button>
			{#if locError}<p class="text-sm text-danger" role="alert">{locError}</p>{/if}
		</fieldset>
		<fieldset class="flex flex-col gap-2">
			<legend class={label}>Planes que aceptas</legend>
			<div class="flex flex-wrap gap-2">
				{#each data.plans as p (p)}
					<label class="flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold">
						<input type="checkbox" name="plans" value={p} class="rounded text-accent focus:ring-accent" />
						{p}
					</label>
				{/each}
			</div>
		</fieldset>
		{#if form?.message}
			<p class="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{form.message}</p>
		{/if}
		<button class="h-12 rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark">Registrar y entrar</button>
	</form>

	<a href="/" class="text-center text-sm font-medium text-accent">Volver a entrar</a>
</main>

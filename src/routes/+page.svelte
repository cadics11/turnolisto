<script lang="ts">
	import { enhance } from '$app/forms';
	import Logo from '#lib/components/Logo.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let tab = $state<'patient' | 'clinic'>('patient');
	$effect(() => {
		if (form?.tab === 'patient' || form?.tab === 'clinic') tab = form.tab;
	});
</script>

<svelte:head><title>Entrar · TurnoListo</title></svelte:head>

<main class="mx-auto flex min-h-[calc(100dvh-44px)] max-w-md flex-col justify-center gap-6 px-5 py-8">
	<Logo size="text-[28px]" />
	<div>
		<h1 class="font-display text-[32px] leading-tight font-bold tracking-tight">Entra con tu usuario</h1>
		<p class="mt-2 text-[15px] leading-relaxed text-muted">
			Pacientes: pide un especialista y te avisamos por SMS cuando salga un turno. Oficinas: publica los
			turnos que quedan libres.
		</p>
	</div>

	<div class="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={tab === 'patient'}
			onclick={() => (tab = 'patient')}
			class="h-11 rounded-lg text-sm font-semibold {tab === 'patient' ? 'bg-accent text-white' : 'text-muted-strong'}"
			>Paciente</button
		>
		<button
			type="button"
			role="tab"
			aria-selected={tab === 'clinic'}
			onclick={() => (tab = 'clinic')}
			class="h-11 rounded-lg text-sm font-semibold {tab === 'clinic' ? 'bg-accent text-white' : 'text-muted-strong'}"
			>Oficina</button
		>
	</div>

	<form
		method="POST"
		action={tab === 'patient' ? '?/patient' : '?/clinic'}
		use:enhance
		class="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4"
	>
		<div class="flex flex-col gap-1.5">
			<label for="username" class="text-[13px] font-semibold text-muted-strong">Usuario</label>
			<input
				id="username"
				name="username"
				required
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				value={form?.tab === tab ? (form?.username ?? '') : ''}
				class="h-11 rounded-[10px] border-line-strong focus:border-accent focus:ring-accent"
			/>
			<p class="text-xs text-muted">
				{tab === 'patient'
					? 'Si es tu primera vez, crearemos tu cuenta con este usuario.'
					: 'El usuario con el que registraste tu oficina.'}
			</p>
		</div>
		{#if form?.message && form.tab === tab}
			<p class="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{form.message}</p>
		{/if}
		<button class="h-12 rounded-xl bg-accent font-semibold text-white hover:bg-accent-dark">Entrar</button>
	</form>

	{#if tab === 'clinic'}
		<p class="text-center text-sm text-muted">
			¿Tu oficina es nueva? <a href="/registro-oficina" class="font-semibold text-accent hover:text-accent-dark"
				>Regístrala aquí</a
			>
		</p>
	{/if}
</main>

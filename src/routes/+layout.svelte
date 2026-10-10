<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Clinics have their own header inside /oficina, so only patients get this bar.
	const links = [
		{ href: '/paciente', label: 'Mis solicitudes' },
		{ href: '/nueva', label: 'Nueva solicitud' },
		{ href: '/sms', label: 'Mensajes' }
	];
	const active = (href: string) =>
		href === '/paciente'
			? page.url.pathname.startsWith('/paciente') || page.url.pathname.startsWith('/solicitud')
			: page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>TurnoListo</title>
</svelte:head>

{#if data.user?.role === 'patient'}
	<nav aria-label="Navegación" class="bg-ink text-paper">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
			{#each links as l (l.href)}
				<a
					href={l.href}
					class="flex min-h-9 items-center rounded-full px-3 hover:bg-white/10 {active(l.href) ? 'bg-white/15 font-semibold' : 'text-paper/85'}"
					aria-current={active(l.href) ? 'page' : undefined}>{l.label}</a
				>
			{/each}
			<span class="ml-auto text-xs text-paper/70">@{data.user.username}</span>
			<form method="POST" action="/logout">
				<button class="min-h-9 rounded-full px-3 text-sm hover:bg-white/10">Salir</button>
			</form>
		</div>
	</nav>
{/if}

{@render children()}


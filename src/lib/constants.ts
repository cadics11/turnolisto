// Shared lists used by both the server (parsing, matching) and the UI.

export const SPECIALTIES = [
	'Ortodoncia',
	'Neurología',
	'Cardiología',
	'Dermatología',
	'Endocrinología',
	'Gastroenterología',
	'Ortopedia',
	'Psiquiatría'
] as const;

export const REGIONS = ['Norte', 'Sur', 'Este', 'Oeste', 'Metro', 'Centro'] as const;

export const PLANS = ['Triple-S', 'MCS', 'Plan Vital', 'First Medical', 'Medicare Advantage'] as const;

/** Town → region. Keys are lowercase without accents (see `normalize`). */
export const TOWN_REGION: Record<string, string> = {
	arecibo: 'Norte',
	manati: 'Norte',
	hatillo: 'Norte',
	camuy: 'Norte',
	'vega baja': 'Norte',
	'vega alta': 'Norte',
	barceloneta: 'Norte',
	ponce: 'Sur',
	'juana diaz': 'Sur',
	guayama: 'Sur',
	salinas: 'Sur',
	yauco: 'Sur',
	humacao: 'Este',
	fajardo: 'Este',
	'rio grande': 'Este',
	yabucoa: 'Este',
	mayaguez: 'Oeste',
	aguadilla: 'Oeste',
	'san german': 'Oeste',
	'cabo rojo': 'Oeste',
	'san juan': 'Metro',
	bayamon: 'Metro',
	carolina: 'Metro',
	guaynabo: 'Metro',
	'toa baja': 'Metro',
	caguas: 'Centro',
	cayey: 'Centro',
	aibonito: 'Centro',
	barranquitas: 'Centro'
};

/** Pretty town names for display. */
export const TOWN_LABEL: Record<string, string> = {
	arecibo: 'Arecibo',
	manati: 'Manatí',
	hatillo: 'Hatillo',
	camuy: 'Camuy',
	'vega baja': 'Vega Baja',
	'vega alta': 'Vega Alta',
	barceloneta: 'Barceloneta',
	ponce: 'Ponce',
	'juana diaz': 'Juana Díaz',
	guayama: 'Guayama',
	salinas: 'Salinas',
	yauco: 'Yauco',
	humacao: 'Humacao',
	fajardo: 'Fajardo',
	'rio grande': 'Río Grande',
	yabucoa: 'Yabucoa',
	mayaguez: 'Mayagüez',
	aguadilla: 'Aguadilla',
	'san german': 'San Germán',
	'cabo rojo': 'Cabo Rojo',
	'san juan': 'San Juan',
	bayamon: 'Bayamón',
	carolina: 'Carolina',
	guaynabo: 'Guaynabo',
	'toa baja': 'Toa Baja',
	caguas: 'Caguas',
	cayey: 'Cayey',
	aibonito: 'Aibonito',
	barranquitas: 'Barranquitas'
};

export const OFFER_MINUTES = 30;

/** Lowercase, strip accents, collapse spaces. */
export function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function formatPhone(digits: string): string {
	const d = digits.replace(/\D/g, '').slice(-10);
	if (d.length !== 10) return digits;
	return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function formatSlot(iso: string): { day: string; time: string; full: string } {
	const d = new Date(iso);
	const day = d.toLocaleDateString('es-PR', { weekday: 'short', day: 'numeric', month: 'short' });
	const time = d.toLocaleTimeString('es-PR', { hour: 'numeric', minute: '2-digit' });
	const full = d.toLocaleString('es-PR', {
		weekday: 'long',
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});
	return { day, time, full };
}
